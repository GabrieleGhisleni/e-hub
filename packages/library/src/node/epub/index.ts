import { readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { EpubError } from "./errors.ts";
import { normalizeIsbn } from "./isbn.ts";
import { ZipError, openCappedZip } from "./zip.ts";

export { EpubError, type EpubErrorCode } from "./errors.ts";
export { normalizeIsbn } from "./isbn.ts";

export interface EpubCover {
  bytes: Uint8Array;
  mediaType: string;
  /** Path of the image inside the zip. */
  href: string;
}

export interface EpubMetadata {
  title: string;
  authors: string[];
  subjects: string[];
  /** ISBN-13 digits. */
  isbn?: string;
  language?: string;
  publisher?: string;
  description?: string;
  cover?: EpubCover;
  warnings: string[];
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

function parseXml(text: string): Node {
  const clean = text.replace(/^﻿/, "");
  try {
    return (parser.parse(clean) as Node) ?? {};
  } catch {
    return {};
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): Node {
  return value && typeof value === "object" ? (value as Node) : {};
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  const node = value as Node;
  return textOf(node["#text"]);
}

function attr(node: Node, name: string): string | undefined {
  const v = node[`@_${name}`];
  return typeof v === "string" ? v : undefined;
}

/** Decodes ZIP entry bytes as UTF-8 text. */
function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

interface ZipReader {
  read(name: string): Uint8Array | undefined;
}

/** Case-insensitive reader over the size-capped zip (see ./zip.ts). */
function openZip(bytes: Uint8Array): ZipReader {
  let zip;
  try {
    zip = openCappedZip(bytes);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new EpubError(error.kind === "too-large" ? "invalid-opf" : "not-a-zip", error.message, {
        cause: error,
      });
    }
    throw error;
  }
  const names = new Map<string, string>(); // lowercase -> actual
  for (const name of zip.names) names.set(name.toLowerCase(), name);
  return {
    read(name) {
      const actual = names.get(name.toLowerCase());
      return actual ? zip.read(actual) : undefined;
    },
  };
}

function safeDecodeURI(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Resolves `href` (URL-encoded, maybe with fragment/query) against the directory of `baseFile`. */
function resolveHref(baseFile: string, href: string): string {
  const withoutSuffix = href.split("#")[0]!.split("?")[0]!;
  const decoded = safeDecodeURI(withoutSuffix);
  if (decoded.startsWith("/")) return path.posix.normalize(decoded.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), decoded));
}

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function mediaTypeFor(href: string, declared?: string): string {
  if (declared?.startsWith("image/")) return declared;
  return IMAGE_TYPES[path.posix.extname(href).toLowerCase()] ?? "application/octet-stream";
}

export function normalizeAuthorName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const parts = trimmed.split(",");
  if (parts.length === 2) {
    const last = parts[0]!.trim();
    const first = parts[1]!.trim();
    if (last && first) return `${first} ${last}`;
  }
  return trimmed;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      } catch {
        return match;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function cleanDescription(raw: string): string {
  const stripped = raw
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

function extractFirstImage(html: string): string | undefined {
  const img = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  const image = /<image\b[^>]*?\b(?:xlink:)?href\s*=\s*["']([^"']+)["']/i.exec(html);
  const candidates = [img, image].filter((m): m is RegExpExecArray => m !== null);
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0]?.[1];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType?: string;
  properties: string[];
}

function fileBaseName(filePath: string): string {
  return path.basename(filePath).replace(/\.(kepub\.)?epub$/i, "");
}

/** Reads the metadata of an EPUB. Anything that goes wrong while parsing is an `EpubError` (never a bare `Error`). */
export async function extractEpubMetadata(input: string | Uint8Array): Promise<EpubMetadata> {
  try {
    return await extractEpubMetadataUnchecked(input);
  } catch (error) {
    if (error instanceof EpubError) throw error;
    throw new EpubError("invalid-opf", `Cannot read the EPUB: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function extractEpubMetadataUnchecked(input: string | Uint8Array): Promise<EpubMetadata> {
  const warnings: string[] = [];
  let bytes: Uint8Array;
  let filePath: string | undefined;
  if (typeof input === "string") {
    filePath = input;
    try {
      bytes = new Uint8Array(readFileSync(input));
    } catch (error) {
      throw new EpubError("not-a-zip", `Cannot read file: ${input}`, { cause: error });
    }
  } else {
    bytes = input;
  }

  const zip = openZip(bytes);

  const containerBytes = zip.read("META-INF/container.xml");
  if (!containerBytes)
    throw new EpubError("missing-container", "META-INF/container.xml not found.");
  const container = parseXml(decode(containerBytes));
  const rootfile = asArray(asNode(asNode(container["container"])["rootfiles"])["rootfile"])
    .map(asNode)
    .find((r) => attr(r, "full-path"));
  const opfPath = rootfile ? attr(rootfile, "full-path")!.replace(/^\/+/, "") : undefined;
  if (!opfPath) throw new EpubError("missing-opf", "container.xml does not point to an OPF file.");
  const opfBytes = zip.read(safeDecodeURI(opfPath)) ?? zip.read(opfPath);
  if (!opfBytes) throw new EpubError("missing-opf", `OPF file not found: ${opfPath}`);
  const opfFile = safeDecodeURI(opfPath);
  const pkg = asNode(parseXml(decode(opfBytes))["package"]);
  if (Object.keys(pkg).length === 0) throw new EpubError("invalid-opf", "OPF has no <package>.");

  const metadata = asNode(pkg["metadata"]);
  const metas = asArray(metadata["meta"]).map(asNode);

  // ---- title
  let title =
    asArray(metadata["title"])
      .map(textOf)
      .find((t) => t.length > 0) ?? "";
  if (!title) {
    if (filePath) {
      title = fileBaseName(filePath);
      warnings.push("Title missing in the OPF: using the file name.");
    } else {
      warnings.push("Title missing in the OPF.");
    }
  }

  // ---- authors
  const refinedRoles = new Map<string, string>();
  for (const m of metas) {
    const refines = attr(m, "refines");
    if (refines && attr(m, "property") === "role") {
      refinedRoles.set(refines.replace(/^#/, ""), textOf(m).toLowerCase());
    }
  }
  const creators = asArray(metadata["creator"]).map((c) => {
    const node = asNode(c);
    const id = attr(node, "id");
    const role = (
      attr(node, "role") ??
      (id ? refinedRoles.get(id) : undefined) ??
      ""
    ).toLowerCase();
    return { name: textOf(c), role };
  });
  const anyRole = creators.some((c) => c.role);
  let chosen = creators;
  if (anyRole) {
    const filtered = creators.filter((c) => !c.role || c.role === "aut");
    if (filtered.length > 0) chosen = filtered;
  }
  const authors = dedupe(chosen.map((c) => normalizeAuthorName(c.name)));
  if (authors.length === 0) warnings.push("No author found.");

  // ---- subjects, language, publisher, description
  const subjects = dedupe(
    asArray(metadata["subject"])
      .map(textOf)
      .map((s) => s.replace(/\s+/g, " ").trim()),
  );
  const language = asArray(metadata["language"]).map(textOf).find(Boolean);
  const publisher = asArray(metadata["publisher"]).map(textOf).find(Boolean);
  const descriptionRaw = asArray(metadata["description"]).map(textOf).find(Boolean);
  const description = descriptionRaw ? cleanDescription(descriptionRaw) || undefined : undefined;

  // ---- ISBN
  let isbn: string | undefined;
  const identifiers = asArray(metadata["identifier"]).map((i) => ({
    value: textOf(i),
    scheme: (attr(asNode(i), "scheme") ?? "").toLowerCase(),
  }));
  // Prefer explicitly labelled identifiers, then any bare value.
  const ordered = [
    ...identifiers.filter((i) => i.scheme === "isbn" || /^(urn:)?isbn:/i.test(i.value)),
    ...identifiers,
  ];
  for (const id of ordered) {
    const normalized = normalizeIsbn(id.value);
    if (normalized) {
      isbn = normalized;
      break;
    }
  }
  if (!isbn) warnings.push("No valid ISBN found.");

  // ---- manifest
  const manifestItems: ManifestItem[] = asArray(asNode(pkg["manifest"])["item"])
    .map(asNode)
    .filter((i) => attr(i, "href"))
    .map((i) => ({
      id: attr(i, "id") ?? "",
      href: attr(i, "href")!,
      mediaType: attr(i, "media-type"),
      properties: (attr(i, "properties") ?? "").split(/\s+/).filter(Boolean),
    }));
  const isImage = (i: ManifestItem) =>
    (i.mediaType?.startsWith("image/") ?? false) || /\.(jpe?g|png|gif|webp|svg)$/i.test(i.href);

  let coverItem: ManifestItem | undefined = manifestItems.find((i) =>
    i.properties.includes("cover-image"),
  );
  if (!coverItem) {
    const coverMeta = metas.find((m) => attr(m, "name")?.toLowerCase() === "cover");
    const target = coverMeta ? attr(coverMeta, "content") : undefined;
    if (target) {
      coverItem =
        manifestItems.find((i) => i.id === target && isImage(i)) ??
        manifestItems.find((i) => i.id === target);
    }
  }
  if (!coverItem) {
    coverItem = manifestItems.find(
      (i) => isImage(i) && (/cover/i.test(i.id) || /cover/i.test(path.posix.basename(i.href))),
    );
  }

  let cover: EpubCover | undefined;
  const loadCover = (inZip: string, declared?: string) => {
    const data = zip.read(inZip);
    if (data && data.length > 0) {
      cover = { bytes: data, mediaType: mediaTypeFor(inZip, declared), href: inZip };
    }
  };
  if (coverItem) loadCover(resolveHref(opfFile, coverItem.href), coverItem.mediaType);

  if (!cover) {
    // Last resort: first image of the first spine document.
    const spineIds = asArray(asNode(pkg["spine"])["itemref"])
      .map((r) => attr(asNode(r), "idref"))
      .filter((x): x is string => !!x);
    const firstDoc = manifestItems.find((i) => i.id === spineIds[0]);
    if (firstDoc) {
      const docPath = resolveHref(opfFile, firstDoc.href);
      const docBytes = zip.read(docPath);
      const src = docBytes ? extractFirstImage(decode(docBytes)) : undefined;
      if (src && !/^data:|^https?:/i.test(src)) loadCover(resolveHref(docPath, src));
    }
  }
  if (!cover) warnings.push("No cover image found.");

  const result: EpubMetadata = { title, authors, subjects, warnings };
  if (isbn) result.isbn = isbn;
  if (language) result.language = language;
  if (publisher) result.publisher = publisher;
  if (description) result.description = description;
  if (cover) result.cover = cover;
  return result;
}
