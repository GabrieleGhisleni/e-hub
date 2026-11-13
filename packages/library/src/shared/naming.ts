/**
 * File names on the Kobo (PLAN §6, rules fixed in Fase 1; Drive was replaced by the Kobo over SSH, see
 * docs/kobo-ssh-migration.md). Flat folder (`kobo.booksDir`), one KEPUB per book plus KOReader's sidecar folder:
 *
 *   <first author> - <title> [<id>].kepub.epub    the book
 *   <first author> - <title> [<id>].kepub.sdr/    KOReader sidecar (custom_metadata.lua, reading progress)
 *
 * Sanitizing (`sanitizeNameSegment`), applied to the author, the title and topic labels:
 *  1. Unicode NFC; every whitespace run (tabs, newlines, NBSP…) becomes one space.
 *  2. Control and invisible formatting characters are removed (C0/C1, soft hyphen, zero-width, bidi overrides).
 *  3. FAT32-forbidden characters:
 *     - `:` `|` `/` `\` are separators: " - " when next to a space ("Sapiens: Da animali a dèi" →
 *       "Sapiens - Da animali a dèi"), "-" between two words ("AC/DC" → "AC-DC", "Re:Zero" → "Re-Zero");
 *     - `"` becomes `'`;
 *     - `?` `*` `<` `>` are removed.
 *  4. Spaces collapsed, repeated " - " collapsed, leading/trailing spaces and dashes trimmed.
 *
 * Length: the first author is cut to 60 characters, then `<author> - <title>` to 120 characters and
 * 200 UTF-8 bytes, at a word boundary when one exists in the second half (otherwise at a character
 * boundary), trailing punctuation removed. The full name stays ≤ 142 characters / 222 bytes: under the
 * FAT32 limit (255 UTF-16 units), ext4's 255 bytes, and short enough for Windows' 260-character paths
 * when copying to the Kobo over USB. The Kobo shows the title from the metadata, so the cut is invisible there.
 *
 * The whole name never starts with a dot (hidden on the Kobo). `topicFolderName` (topic labels: same sanitizer, max 60
 * characters / 120 bytes, no trailing dots or spaces, DOS device names get a "_" suffix) is kept to refuse two labels
 * that would look the same.
 */
import type { Book } from "./schema.ts";
import { graphemes, utf8Length } from "./text.ts";

/** What a name on the Kobo is: the KEPUB file, or its KOReader sidecar folder. */
export type KoboEntryKind = "kepub" | "sidecar";

export const KOBO_ENTRY_SUFFIXES: Readonly<Record<KoboEntryKind, string>> = {
  kepub: ".kepub.epub",
  sidecar: ".kepub.sdr",
};

/** The metadata file KOReader reads inside the sidecar folder (`custom_props.series` = topic label). */
export const KOBO_SIDECAR_METADATA_FILE = "custom_metadata.lua";

export const KOBO_AUTHOR_MAX_CHARS = 60;
export const KOBO_BASE_MAX_CHARS = 120;
export const KOBO_BASE_MAX_BYTES = 200;
export const TOPIC_FOLDER_MAX_CHARS = 60;
export const TOPIC_FOLDER_MAX_BYTES = 120;

const UNTITLED = "Senza titolo";

const INVISIBLE = /[\p{Cc}­᠎​-‏‪-‮⁠-⁤﻿]/gu;
const SPACED_SEPARATOR = /\s*[:|/\\]\s+|\s+[:|/\\]\s*/g;
const BARE_SEPARATOR = /[:|/\\]/g;
const REMOVED = /[?*<>]/g;

/** Makes one piece of a Kobo file name FAT32-safe (see the module comment). May return "". */
export function sanitizeNameSegment(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .replace(SPACED_SEPARATOR, " - ")
    .replace(BARE_SEPARATOR, "-")
    .replace(/"/g, "'")
    .replace(REMOVED, "")
    .replace(/ {2,}/g, " ")
    .replace(/ -(?: -)+ /g, " - ")
    .replace(/^[\s-]+|[\s-]+$/g, "");
}

const TRAILING_AFTER_CUT = /[\s\-–—,;:([{'"«]+$/u;

/**
 * Cuts `text` to at most `maxChars` graphemes and `maxBytes` UTF-8 bytes. Prefers the last word boundary
 * in the second half of the allowed text; strips the punctuation left dangling by the cut.
 */
export function truncateName(
  text: string,
  maxChars: number,
  maxBytes = Number.POSITIVE_INFINITY,
): string {
  const parts = graphemes(text);
  if (parts.length <= maxChars && utf8Length(text) <= maxBytes) return text;
  let out = "";
  let count = 0;
  let bytes = 0;
  for (const g of parts) {
    const b = utf8Length(g);
    if (count + 1 > maxChars || bytes + b > maxBytes) break;
    out += g;
    count += 1;
    bytes += b;
  }
  const next = parts[count] ?? "";
  if (!/^\s$/u.test(next)) {
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace >= out.length / 2) out = out.slice(0, lastSpace);
  }
  return out.replace(TRAILING_AFTER_CUT, "");
}

/** `<first author> - <title>`, sanitized and truncated, without ID and extension. */
export function koboBaseName(book: Pick<Book, "title" | "authors">): string {
  const author = truncateName(sanitizeNameSegment(book.authors[0] ?? ""), KOBO_AUTHOR_MAX_CHARS);
  const title = sanitizeNameSegment(book.title);
  const joined = author && title ? `${author} - ${title}` : author || title;
  const base = truncateName(joined, KOBO_BASE_MAX_CHARS, KOBO_BASE_MAX_BYTES).replace(
    /^[.\s]+/,
    "",
  );
  return base || UNTITLED;
}

/**
 * Name on the Kobo: `kepub` → `Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].kepub.epub`, `sidecar` → the
 * same with `.kepub.sdr` (KOReader's folder for that file).
 */
export function koboFileName(
  book: Pick<Book, "id" | "title" | "authors">,
  kind: KoboEntryKind = "kepub",
): string {
  return `${koboBaseName(book)} [${book.id}]${KOBO_ENTRY_SUFFIXES[kind]}`;
}

const DOS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

/** Folder-safe form of a topic label (same sanitizer as files; never empty, never hidden): used to refuse look-alike labels. */
export function topicFolderName(label: string): string {
  let name = truncateName(
    sanitizeNameSegment(label),
    TOPIC_FOLDER_MAX_CHARS,
    TOPIC_FOLDER_MAX_BYTES,
  )
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (!name) name = "_";
  if (DOS_DEVICE.test(name)) name += "_";
  return name;
}

const KOBO_NAME_PATTERN = /\[([0-9abcdefghjkmnpqrstvwxyz]{8})\]\.kepub\.(epub|sdr)$/i;

/**
 * Reads the book ID and the kind back from a name or path on the Kobo (`… [<id>].kepub.epub` → kepub,
 * `… [<id>].kepub.sdr` → sidecar). Only the bracket group right before the suffix counts. Returns null for names we
 * did not produce (e.g. `Clear, James - Atomic habits.kepub.epub`, copied by hand: never touched).
 */
export function parseKoboFileName(name: string): { id: string; kind: KoboEntryKind } | null {
  const base = name.replace(/\/+$/, "").slice(name.replace(/\/+$/, "").lastIndexOf("/") + 1);
  const match = KOBO_NAME_PATTERN.exec(base);
  if (!match?.[1] || !match[2]) return null;
  return {
    id: match[1].toLowerCase(),
    kind: match[2].toLowerCase() === "sdr" ? "sidecar" : "kepub",
  };
}

export function parseIdFromKoboName(name: string): string | null {
  return parseKoboFileName(name)?.id ?? null;
}
