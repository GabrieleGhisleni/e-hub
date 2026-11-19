/**
 * Highlights made on the Kobo with KOReader, pulled into `data/books/<id>/highlights.json` by `elib sync`.
 *
 * KOReader keeps them in the book's sidecar, `<name>.kepub.sdr/metadata.epub.lua`: a Lua table literal. Recent
 * versions write `annotations` (one entry per highlight or bookmark, with `text`, `note`, `chapter`, `pageno`,
 * `pos0`, `datetime`); older ones `highlight` (by page). Page bookmarks (no `pos0`) are skipped.
 *
 * The list is kept in reading order: by position in the book (the XPointer `pos0`), not by creation date.
 * Read-only on the Kobo: nothing is written there.
 */
import { koboFileName, parseKoboFileName } from "../../shared/naming.ts";
import {
  BOOK_HIGHLIGHTS_VERSION,
  type Book,
  type BookHighlights,
  type Highlight,
} from "../../shared/schema.ts";
import { publicationHighlight } from "../repo/highlights.ts";
import { InvalidDataError, readBookHighlights, writeBookHighlights } from "../repo/index.ts";
import { koboAllowed } from "./access.ts";
import type { KoboContext } from "./context.ts";

/** KOReader's per-book settings file inside the sidecar folder (the book is a `.epub` for KOReader). */
export const KOREADER_METADATA_FILE = "metadata.epub.lua";

// ---------------------------------------------------------------------------------------------
// Lua table literal parser (the subset KOReader's settings dump writes)
// ---------------------------------------------------------------------------------------------

export type LuaValue = string | number | boolean | null | LuaTable;
/** A Lua table: keys as strings (`1`, `2`… for the array part). */
export type LuaTable = { [key: string]: LuaValue };

export class LuaParseError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} (at character ${offset})`);
    this.name = "LuaParseError";
  }
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "\n": "\n",
};

/** Parses `return { ... }` (comments, strings with escapes, numbers, booleans, nil, nested tables). */
export function parseLuaTable(source: string): LuaTable {
  let i = 0;

  const skip = () => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i]!)) i++;
      if (source.startsWith("--", i)) {
        const end = source.indexOf("\n", i);
        i = end === -1 ? source.length : end + 1;
        continue;
      }
      return;
    }
  };

  const expect = (char: string) => {
    skip();
    if (source[i] !== char) throw new LuaParseError(`expected "${char}"`, i);
    i++;
  };

  const parseString = (): string => {
    const quote = source[i]!;
    i++;
    const bytes: number[] = [];
    const pushText = (text: string) => bytes.push(...Buffer.from(text, "utf8"));
    while (i < source.length && source[i] !== quote) {
      const char = source[i]!;
      if (char !== "\\") {
        const code = source.codePointAt(i)!;
        const text = String.fromCodePoint(code);
        pushText(text);
        i += text.length;
        continue;
      }
      const next = source[i + 1] ?? "";
      if (/\d/.test(next)) {
        // \ddd: a byte (KOReader may escape bytes of multi-byte characters).
        const digits = /^\d{1,3}/.exec(source.slice(i + 1))![0];
        bytes.push(Number(digits) & 0xff);
        i += 1 + digits.length;
      } else if (next === "x") {
        bytes.push(parseInt(source.slice(i + 2, i + 4), 16));
        i += 4;
      } else if (next === "z") {
        i += 2;
        while (i < source.length && /\s/.test(source[i]!)) i++;
      } else {
        pushText(ESCAPES[next] ?? next);
        i += 2;
      }
    }
    if (source[i] !== quote) throw new LuaParseError("unterminated string", i);
    i++;
    return Buffer.from(bytes).toString("utf8");
  };

  const parseValue = (): LuaValue => {
    skip();
    const char = source[i];
    if (char === "{") return parseTable();
    if (char === '"' || char === "'") return parseString();
    const word = /^(?:true|false|nil|-?(?:0x[0-9a-f]+|\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?))/i.exec(
      source.slice(i, i + 64),
    );
    if (!word) throw new LuaParseError("unexpected value", i);
    i += word[0].length;
    if (word[0] === "true") return true;
    if (word[0] === "false") return false;
    if (word[0] === "nil") return null;
    return Number(word[0]);
  };

  const parseTable = (): LuaTable => {
    expect("{");
    const table: LuaTable = {};
    let next = 1;
    for (;;) {
      skip();
      if (source[i] === "}") {
        i++;
        return table;
      }
      let key: string;
      if (source[i] === "[") {
        i++;
        const raw = parseValue();
        expect("]");
        expect("=");
        key = String(raw);
      } else {
        const name = /^[A-Za-z_]\w*\s*=(?!=)/.exec(source.slice(i, i + 256));
        if (name) {
          key = name[0].replace(/\s*=$/, "");
          i += name[0].length;
        } else {
          key = String(next++);
        }
      }
      const value = parseValue();
      if (value !== null) table[key] = value;
      skip();
      if (source[i] === "," || source[i] === ";") i++;
    }
  };

  skip();
  if (source.startsWith("return", i)) i += "return".length;
  const table = parseTable();
  skip();
  if (i < source.length) throw new LuaParseError("unexpected text after the table", i);
  return table;
}

// ---------------------------------------------------------------------------------------------
// Highlights out of the metadata table
// ---------------------------------------------------------------------------------------------

const isTable = (value: LuaValue | undefined): value is LuaTable =>
  typeof value === "object" && value !== null;
const str = (value: LuaValue | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
const int = (value: LuaValue | undefined): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

/** Entries of a Lua array part, in order (`1`, `2`, …; other keys after, by key). */
function entries(table: LuaTable): LuaValue[] {
  return Object.keys(table)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((key) => table[key]!);
}

/** Normalizes the whitespace KOReader keeps from the page layout (hyphenation breaks, runs of spaces). */
function cleanText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function highlightFrom(entry: LuaTable, page?: number): (Highlight & { order: number }) | null {
  const pos = str(entry.pos0);
  const text = str(entry.text);
  // Page bookmarks have no pos0; highlights without text are useless here.
  if (!pos || !text) return null;
  const note = str(entry.note);
  const chapter = str(entry.chapter);
  const pageno = int(entry.pageno) ?? page;
  const createdAt = str(entry.datetime);
  return {
    text: cleanText(text),
    ...(note ? { note: note.trim() } : {}),
    ...(chapter ? { chapter } : {}),
    ...(pageno ? { page: pageno } : {}),
    pos,
    ...(createdAt ? { createdAt } : {}),
    order: 0,
  };
}

/** Numbers along an XPointer (`/body/DocFragment[6]/body/div/p[3]/text().14` → [6, 3, 14]). */
function positionKey(pos: string | undefined): number[] {
  if (!pos) return [];
  return [...pos.matchAll(/\[(\d+)\]|\.(\d+)$/g)].map((m) => Number(m[1] ?? m[2]));
}

function fragmentOf(pos: string | undefined): number {
  const match = /DocFragment\[(\d+)\]/.exec(pos ?? "");
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Reading order: the book's file (DocFragment) first, then the page, then the position inside the page. Ties keep
 * the order KOReader stored them in.
 */
export function compareReadingOrder(
  a: Highlight & { order?: number },
  b: Highlight & { order?: number },
): number {
  const byFragment = fragmentOf(a.pos) - fragmentOf(b.pos);
  if (byFragment !== 0) return byFragment;
  if (a.page !== undefined && b.page !== undefined && a.page !== b.page) return a.page - b.page;
  const ka = positionKey(a.pos);
  const kb = positionKey(b.pos);
  for (let k = 0; k < Math.min(ka.length, kb.length); k++) {
    if (ka[k] !== kb[k]) return ka[k]! - kb[k]!;
  }
  return ka.length - kb.length || (a.order ?? 0) - (b.order ?? 0);
}

/** The highlights in a KOReader metadata table, in reading order, without duplicates. */
export function highlightsFromMetadata(metadata: LuaTable): Highlight[] {
  const found: (Highlight & { order: number })[] = [];
  const annotations = metadata.annotations;
  if (isTable(annotations)) {
    for (const entry of entries(annotations)) {
      if (!isTable(entry)) continue;
      const highlight = highlightFrom(entry);
      if (highlight) found.push(highlight);
    }
  }
  // Older KOReader: `highlight = { [page] = { [1] = {...} } }`, used only when there are no annotations.
  const legacy = metadata.highlight;
  if (found.length === 0 && isTable(legacy)) {
    for (const [pageKey, items] of Object.entries(legacy)) {
      if (!isTable(items)) continue;
      for (const entry of entries(items)) {
        if (!isTable(entry)) continue;
        const highlight = highlightFrom(entry, int(Number(pageKey)));
        if (highlight) found.push(highlight);
      }
    }
  }
  found.forEach((h, index) => (h.order = index));
  found.sort(compareReadingOrder);
  const seen = new Set<string>();
  return found.flatMap(({ order: _order, ...highlight }) => {
    const key = `${highlight.pos}\u0000${highlight.text}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [highlight];
  });
}

// ---------------------------------------------------------------------------------------------
// Pull: Kobo → data/books/<id>/highlights.json
// ---------------------------------------------------------------------------------------------

export type HighlightsPullStatus =
  /** highlights.json written (or would be, in a dry run). */
  | "updated"
  | "unchanged"
  /** The Kobo has none but highlights.json has some: kept (a reset sidecar must not wipe them). */
  | "kept";

export interface HighlightsPullItem {
  bookId: string;
  title: string;
  status: HighlightsPullStatus;
  /** Highlights in the file after the pull. */
  count: number;
  added: number;
  removed: number;
}

export interface HighlightsPullReport {
  dryRun: boolean;
  /** Books whose sidecar has a KOReader metadata file (others are not mentioned). */
  items: HighlightsPullItem[];
  errors: { bookId?: string; message: string }[];
}

const identity = (h: Highlight) => `${h.pos ?? ""}\u0000${h.text}\u0000${h.note ?? ""}`;

/**
 * Reads the highlights of `books` from the Kobo and writes the `highlights.json` that changed. One listing of the Kobo;
 * the sidecar folder is found by the `[<id>]` in its name, so a sidecar not yet renamed still counts.
 */
export async function pullHighlights(
  ctx: KoboContext,
  books: readonly Book[],
  options: { dryRun?: boolean; now?: () => Date } = {},
): Promise<HighlightsPullReport> {
  const dryRun = ctx.dryRun || options.dryRun === true;
  const report: HighlightsPullReport = { dryRun, items: [], errors: [] };
  if (!koboAllowed()) return report;
  let listing;
  try {
    listing = await ctx.transport.list();
  } catch (error) {
    report.errors.push({ message: `cannot list the Kobo: ${(error as Error).message}` });
    return report;
  }
  const sidecars = new Map<string, string[]>();
  for (const entry of listing) {
    const parsed = entry.dir ? parseKoboFileName(entry.name) : null;
    if (parsed?.kind !== "sidecar") continue;
    sidecars.set(parsed.id, [...(sidecars.get(parsed.id) ?? []), entry.name]);
  }

  for (const book of books) {
    const expected = koboFileName(book, "sidecar");
    const candidates = sidecars.get(book.id) ?? [];
    // The expected name first; another name (not yet renamed) only when it is the only one.
    const sidecar = candidates.includes(expected) ? expected : candidates.length === 1 ? candidates[0] : undefined;
    if (!sidecar) continue;
    try {
      const source = await ctx.transport.readFile(`${sidecar}/${KOREADER_METADATA_FILE}`);
      if (source === null) continue;
      const fromKobo = highlightsFromMetadata(parseLuaTable(source)).map(publicationHighlight);
      let current: BookHighlights | null = null;
      try {
        current = await readBookHighlights(ctx.dataDir, book.id);
      } catch (error) {
        if (!(error instanceof InvalidDataError)) throw error;
        // An invalid file is replaced by what the Kobo has.
      }
      const before = current?.highlights ?? [];
      const beforeKeys = new Set(before.map(identity));
      const afterKeys = new Set(fromKobo.map(identity));
      const added = fromKobo.filter((h) => !beforeKeys.has(identity(h))).length;
      const removed = before.filter((h) => !afterKeys.has(identity(h))).length;
      const sameOrder =
        before.length === fromKobo.length && before.every((h, k) => identity(h) === identity(fromKobo[k]!));

      let status: HighlightsPullStatus;
      if (fromKobo.length === 0 && before.length > 0) status = "kept";
      else if (sameOrder && current !== null) status = "unchanged";
      else if (fromKobo.length === 0 && current === null) continue;
      else status = "updated";

      if (status === "updated" && !dryRun) {
        await writeBookHighlights(ctx.dataDir, {
          version: BOOK_HIGHLIGHTS_VERSION,
          bookId: book.id,
          syncedAt: (options.now?.() ?? new Date()).toISOString(),
          highlights: fromKobo,
        });
      }
      const count = status === "kept" ? before.length : fromKobo.length;
      report.items.push({
        bookId: book.id,
        title: book.title,
        status,
        count,
        added: status === "kept" ? 0 : added,
        removed: status === "kept" ? 0 : removed,
      });
    } catch (error) {
      report.errors.push({ bookId: book.id, message: `highlights not read: ${(error as Error).message}` });
    }
  }
  return report;
}

/** Lines for the CLI: one per book that changed, then a total. */
export function formatHighlightsReport(report: HighlightsPullReport): string[] {
  const lines: string[] = [];
  const verb = report.dryRun ? "would update" : "updated";
  for (const item of report.items) {
    if (item.status === "updated") {
      const delta = [item.added ? `+${item.added}` : "", item.removed ? `-${item.removed}` : ""]
        .filter(Boolean)
        .join(" ");
      lines.push(`  highlights ${verb}: ${item.title} [${item.bookId}] — ${item.count}${delta ? ` (${delta})` : ""}`);
    } else if (item.status === "kept") {
      lines.push(
        `  highlights kept: ${item.title} [${item.bookId}] — the Kobo has none, the ${item.count} saved are left as they are`,
      );
    }
  }
  for (const error of report.errors) {
    lines.push(`  highlights error${error.bookId ? ` [${error.bookId}]` : ""}: ${error.message}`);
  }
  const total = report.items.reduce((sum, item) => sum + item.count, 0);
  const changed = report.items.filter((item) => item.status === "updated").length;
  lines.unshift(
    `Highlights: ${total} in ${report.items.length} book(s)` +
      (changed > 0 ? `, ${changed} ${report.dryRun ? "to update" : "updated"}` : ", nothing new"),
  );
  return lines;
}
