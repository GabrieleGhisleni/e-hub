/**
 * LibGen fallback (libgen.gl/.li layout): HTML search + download, no account. Used when Z-Library cannot answer.
 * Results are mapped to `ZlibraryBook` with `id = "libgen"` and `hash = md5`, so the existing routes and UI work as is.
 *
 *   LIBGEN_BASE_URL   mirror, default https://libgen.gl (comma-separated list: the first that answers wins)
 */
import type { ZlibraryBook, ZlibrarySearchRequest, ZlibrarySearchResponse } from "../../shared/zlibrary.ts";
import { ZlibrarySearchRequestSchema } from "../../shared/zlibrary.ts";
import { type DownloadedFile, ZlibraryError } from "./index.ts";

export const LIBGEN_ID = "libgen";
const DEFAULT_BASE_URL = "https://libgen.gl";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_SIZE = 25;

export function libgenBasesFrom(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.LIBGEN_BASE_URL?.trim();
  const list = (raw ? raw.split(",") : [DEFAULT_BASE_URL]).map((b) => b.trim().replace(/\/+$/, "")).filter(Boolean);
  return list.length ? list : [DEFAULT_BASE_URL];
}

export class LibgenClient {
  private readonly bases: string[];
  constructor(bases: string[] = libgenBasesFrom()) {
    this.bases = bases;
  }

  async search(input: ZlibrarySearchRequest): Promise<ZlibrarySearchResponse> {
    const req = ZlibrarySearchRequestSchema.parse(input);
    const params = new URLSearchParams([
      ["req", req.query],
      ["columns[]", "t"],
      ["columns[]", "a"],
      ["objects[]", "f"],
      ["topics[]", "l"],
      ["topics[]", "f"],
      ["res", String(PAGE_SIZE)],
      ["filesuns", "all"],
      ["page", String(req.page)],
    ]);
    const { text } = await this.get(`/index.php?${params}`);
    const all = parseLibgenResults(text);
    const exts = req.extensions.map((e) => e.toUpperCase());
    const maxBytes = req.maxSizeMb === undefined ? undefined : req.maxSizeMb * 1024 * 1024;
    const books = all.filter((b) => {
      if (exts.length && !exts.includes(b.extension)) return false;
      if (maxBytes !== undefined && b.size !== null && b.size > maxBytes) return false;
      if (req.yearFrom !== undefined && b.year !== null && b.year < req.yearFrom) return false;
      if (req.yearTo !== undefined && b.year !== null && b.year > req.yearTo) return false;
      return true;
    });
    return { books, page: req.page, totalPages: null, totalItems: null, filteredOut: all.length - books.length };
  }

  async download(md5: string, maxBytes: number, onlyExtension?: string): Promise<DownloadedFile> {
    if (!/^[a-f0-9]{32}$/i.test(md5)) throw new ZlibraryError("failed", "Identificativo LibGen non valido.");
    const { text: page } = await this.get(`/ads.php?md5=${md5}`);
    const link = /href=["']((?:https?:\/\/[^"']+)?\/?get\.php\?md5=[^"']+)["']/i.exec(page)?.[1];
    if (!link) throw new ZlibraryError("failed", "LibGen non ha fornito un link di download.");
    const href = decodeEntities(link);
    let lastError = "download non riuscito";
    for (const base of this.bases) {
      try {
        const response = await fetch(new URL(href.startsWith("http") ? href : `/${href.replace(/^\//, "")}`, base), {
          headers: { "User-Agent": USER_AGENT, Referer: `${base}/ads.php?md5=${md5}` },
          redirect: "follow",
          signal: AbortSignal.timeout(5 * 60_000),
        });
        const type = (response.headers.get("content-type") ?? "").toLowerCase();
        if (!response.ok || type.includes("text/html")) {
          await response.body?.cancel();
          lastError = `HTTP ${response.status}`;
          continue;
        }
        if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
          await response.body?.cancel();
          throw new ZlibraryError("failed", `Il file supera il limite di ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > maxBytes) {
          throw new ZlibraryError("failed", bytes.length ? "Il file supera il limite di dimensione." : "File vuoto da LibGen.");
        }
        const extension = sniffExtension(bytes, onlyExtension);
        if (onlyExtension && extension !== onlyExtension.toLowerCase()) {
          throw new ZlibraryError("wrong-format", `Solo gli ${onlyExtension.toUpperCase()} sono supportati.`);
        }
        return { bytes, extension, displayName: `libgen-${md5}` };
      } catch (error) {
        if (error instanceof ZlibraryError) throw error;
        lastError = (error as Error).message;
      }
    }
    throw new ZlibraryError("failed", `Download da LibGen non riuscito: ${lastError}`);
  }

  private async get(pathAndQuery: string): Promise<{ text: string; base: string }> {
    let lastError = "nessun mirror";
    for (const base of this.bases) {
      try {
        const response = await fetch(`${base}${pathAndQuery}`, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html", },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          lastError = `${new URL(base).host}: HTTP ${response.status}`;
          continue;
        }
        return { text: await response.text(), base };
      } catch (error) {
        lastError = `${new URL(base).host}: ${(error as Error).message}`;
      }
    }
    throw new ZlibraryError("failed", `LibGen non raggiungibile (${lastError}). Imposta LIBGEN_BASE_URL con un mirror attivo.`);
  }
}

/** ZIP signature → epub, otherwise the declared extension (or "bin"). */
function sniffExtension(bytes: Uint8Array, hint?: string): string {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (pdf) return "pdf";
  if (zip) return "epub";
  return hint ? "bin" : "bin";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseSize(label: string): number | null {
  const m = /([\d.,]+)\s*(kb|mb|gb|b)\b/i.exec(label);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[2]!.toLowerCase() as "b" | "kb" | "mb" | "gb"];
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

/** Parses the result table of libgen.li `index.php` (cells: title, author, publisher, year, language, pages, size, ext, mirrors). */
export function parseLibgenResults(html: string): ZlibraryBook[] {
  const books: ZlibraryBook[] = [];
  const seen = new Set<string>();
  for (const row of html.match(/<tr[\s>][\s\S]*?<\/tr>/gi) ?? []) {
    const md5 = /md5=([a-f0-9]{32})/i.exec(row)?.[1]?.toLowerCase();
    if (!md5 || seen.has(md5)) continue;
    let tds: string[] = row.match(/<td[\s>][\s\S]*?<\/td>/gi) ?? [];
    // with the covers cookie the first column is the thumbnail alone
    if (tds[0] && /<img/i.test(tds[0]) && textOf(tds[0]) === "") tds = tds.slice(1);
    const cells = tds.map(textOf);
    if (cells.length < 8) continue;
    seen.add(md5);
    const titleCell = tds[0]!;
    const titleLink = /href=["']edition\.php[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(titleCell)?.[1];
    const year = Number(/\d{4}/.exec(cells[3] ?? "")?.[0]);
    const pages = Number(/\d+/.exec(cells[5] ?? "")?.[0]);
    const sizeLabel = cells[6] || null;
    books.push({
      id: LIBGEN_ID,
      hash: md5,
      title: textOf(titleLink ?? cells[0] ?? "") || "Senza titolo",
      author: cells[1]?.replace(/[,\s]+$/, "") || "Autore sconosciuto",
      year: year > 0 ? year : null,
      extension: (cells[7] || "?").toUpperCase(),
      size: sizeLabel ? parseSize(sizeLabel) : null,
      sizeLabel,
      language: cells[4] || null,
      publisher: cells[2] || null,
      cover: null, // libgen's thumbnails are empty files: the route fills it from Open Library
      description: null,
      pages: pages > 0 ? pages : null,
      isbn: null,
      source: "libgen",
    });
  }
  return books;
}
