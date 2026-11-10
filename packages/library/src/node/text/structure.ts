/**
 * EPUB structure for text extraction: spine (reading order) and table of contents (EPUB 3 nav, EPUB 2 NCX).
 * Own small parser: the metadata module of W2a does not expose the OPF internals.
 */
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { ZipError, openCappedZip } from "../epub/zip.ts";

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

export class EpubTextError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EpubTextError";
  }
}

function parseXml(text: string): Node {
  try {
    return (parser.parse(text.replace(/^﻿/, "")) as Node) ?? {};
  } catch {
    return {};
  }
}

function arr<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function node(value: unknown): Node {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};
}

function attr(n: Node, name: string): string | undefined {
  const v = n[`@_${name}`];
  return typeof v === "string" ? v : undefined;
}

/** All text below a parsed node, in the order fast-xml-parser exposes it (good enough for TOC labels). */
function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  const n = value as Node;
  const parts: string[] = [];
  if ("#text" in n) parts.push(textOf(n["#text"]));
  for (const [key, child] of Object.entries(n)) {
    if (key.startsWith("@_") || key === "#text") continue;
    parts.push(textOf(child));
  }
  return parts.join(" ");
}

function cleanLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface SpineDoc {
  /** Zip path (normalized, no leading slash). */
  path: string;
  html: string;
}

export interface TocEntry {
  title: string;
  /** Zip path of the target document. */
  file: string;
  fragment?: string;
  /** 1 = top level. */
  depth: number;
  /** True when the entry has children in the TOC. */
  hasChildren: boolean;
}

export interface EpubStructure {
  spine: SpineDoc[];
  toc: TocEntry[];
}

function normalizeZipPath(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, "/")).replace(/^\/+/, "");
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Resolves `href` (possibly with `#fragment`) against the zip path of the document that contains it. */
function resolveHref(
  baseFile: string,
  href: string,
): { file: string; fragment?: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
  const [filePart = "", ...rest] = href.split("#");
  const fragment = rest.length > 0 ? decodeHref(rest.join("#")) : undefined;
  const file =
    filePart === ""
      ? baseFile
      : normalizeZipPath(path.posix.join(path.posix.dirname(baseFile), decodeHref(filePart)));
  return { file, ...(fragment ? { fragment } : {}) };
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export function readEpubStructure(input: Uint8Array): EpubStructure {
  let zip;
  try {
    zip = openCappedZip(input);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new EpubTextError(
        error.kind === "too-large" ? error.message : "not a valid EPUB (zip cannot be read)",
        { cause: error },
      );
    }
    throw error;
  }
  const byPath = new Map<string, string>(); // normalized path -> stored name
  for (const name of zip.names) byPath.set(normalizeZipPath(name), name);
  const read = (p: string): string | undefined => {
    const stored = byPath.get(p);
    if (stored === undefined) return undefined;
    try {
      const bytes = zip.read(stored);
      return bytes ? new TextDecoder("utf-8").decode(bytes) : undefined;
    } catch (error) {
      if (error instanceof ZipError) throw new EpubTextError(error.message, { cause: error });
      throw error;
    }
  };

  const containerXml = read("META-INF/container.xml");
  if (!containerXml) throw new EpubTextError("EPUB has no META-INF/container.xml");
  const rootfile = arr(node(node(node(parseXml(containerXml).container).rootfiles)).rootfile)
    .map(node)
    .find((r) => attr(r, "full-path"));
  const opfPath = normalizeZipPath(attr(rootfile ?? {}, "full-path") ?? "");
  const opfText = opfPath ? read(opfPath) : undefined;
  if (!opfText) throw new EpubTextError("EPUB package document (OPF) not found");

  const pkg = node(parseXml(opfText).package);
  const opfDir = path.posix.dirname(opfPath);
  const manifest = new Map<string, ManifestItem>();
  for (const raw of arr(node(pkg.manifest).item)) {
    const item = node(raw);
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: normalizeZipPath(path.posix.join(opfDir, decodeHref(href.split("#")[0] ?? ""))),
      mediaType: attr(item, "media-type") ?? "",
      properties: (attr(item, "properties") ?? "").split(/\s+/).filter(Boolean),
    });
  }

  const navItem = [...manifest.values()].find((i) => i.properties.includes("nav"));
  const spineNode = node(pkg.spine);
  const ncxItem =
    manifest.get(attr(spineNode, "toc") ?? "") ??
    [...manifest.values()].find((i) => i.mediaType === "application/x-dtbncx+xml");

  const spine: SpineDoc[] = [];
  for (const raw of arr(spineNode.itemref)) {
    const id = attr(node(raw), "idref");
    const item = id ? manifest.get(id) : undefined;
    if (!item || item === navItem) continue;
    if (!/x?html/i.test(item.mediaType) && !/\.x?html?$/i.test(item.href)) continue;
    const html = read(item.href);
    if (html !== undefined) spine.push({ path: item.href, html });
  }
  if (spine.length === 0) throw new EpubTextError("EPUB has an empty reading order (spine)");

  let toc: TocEntry[] = [];
  if (navItem) {
    const text = read(navItem.href);
    if (text) toc = parseNav(text, navItem.href);
  }
  if (toc.length === 0 && ncxItem) {
    const text = read(ncxItem.href);
    if (text) toc = parseNcx(text, ncxItem.href);
  }
  return { spine, toc };
}

function parseNcx(text: string, ncxPath: string): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (points: unknown, depth: number): void => {
    for (const raw of arr(points)) {
      const point = node(raw);
      const src = attr(node(point.content), "src");
      const target = src ? resolveHref(ncxPath, src) : undefined;
      const children = arr(point.navPoint);
      if (target) {
        const label = cleanLabel(textOf(node(point.navLabel).text ?? point.navLabel));
        out.push({ title: label, ...target, depth, hasChildren: children.length > 0 });
      }
      walk(children, depth + 1);
    }
  };
  walk(node(node(parseXml(text).ncx).navMap).navPoint, 1);
  return out;
}

function findNavs(value: unknown, acc: Node[] = []): Node[] {
  if (Array.isArray(value)) {
    for (const v of value) findNavs(v, acc);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Node)) {
      if (key === "nav") acc.push(...arr(child).map(node));
      if (!key.startsWith("@_")) findNavs(child, acc);
    }
  }
  return acc;
}

function parseNav(text: string, navPath: string): TocEntry[] {
  const navs = findNavs(parseXml(text));
  const toc =
    navs.find((n) => (attr(n, "type") ?? "").split(/\s+/).includes("toc")) ??
    (navs.length === 1 ? navs[0] : undefined);
  if (!toc) return [];
  const out: TocEntry[] = [];
  const walkList = (ol: unknown, depth: number): void => {
    for (const rawLi of arr(node(ol).li)) {
      const li = node(rawLi);
      const link = arr(li.a).map(node)[0];
      const children = arr(li.ol);
      const href = link ? attr(link, "href") : undefined;
      const target = href ? resolveHref(navPath, href) : undefined;
      if (target && link) {
        out.push({
          title: cleanLabel(textOf(link)),
          ...target,
          depth,
          hasChildren: children.length > 0,
        });
      }
      for (const child of children) walkList(child, depth + 1);
    }
  };
  for (const ol of arr(toc.ol)) walkList(ol, 1);
  return out;
}
