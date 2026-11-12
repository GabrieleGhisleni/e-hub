/**
 * Search over the book text for the `search_book` tool: case- and accent-insensitive. Exact phrase first; when there
 * is none and the query has several words, the lines that contain all of them.
 */
import type { BookText } from "./text.ts";

/** Characters of context on each side of a match. */
export const SNIPPET_RADIUS = 100;

export type SearchHit = { chapter: number; title: string; snippet: string };

export type SearchResult = {
  /** "phrase": exact phrase; "all-words": lines with all the words; "none": no hit. */
  mode: "phrase" | "all-words" | "none";
  /** Number of hits found (all of them; `hits` holds the same list). */
  total: number;
  hits: SearchHit[];
};

/**
 * Lower case, no diacritics, whitespace runs collapsed to one space. `origin[i]` is the index in `text` (UTF-16) of
 * the character at index `i` of `norm`, so a match can be shown from the original text.
 */
export function normalizeForSearch(text: string): { norm: string; origin: number[] } {
  let norm = "";
  const origin: number[] = [];
  let index = 0;
  let previousSpace = true;
  for (const ch of text) {
    const at = index;
    index += ch.length;
    if (/\s/u.test(ch)) {
      if (!previousSpace) {
        norm += " ";
        origin.push(at);
        previousSpace = true;
      }
      continue;
    }
    previousSpace = false;
    const folded = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const unit of folded) {
      norm += unit;
      for (let k = 0; k < unit.length; k++) origin.push(at);
    }
  }
  return { norm: norm.trimEnd(), origin };
}

/** About `SNIPPET_RADIUS` characters around `index` (and `span` more after it), whitespace collapsed. */
export function snippetAt(text: string, index: number, span: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + span + SNIPPET_RADIUS);
  return `…${text.slice(start, end).replace(/\s+/g, " ").trim()}…`;
}

export async function searchBook(text: BookText, query: string): Promise<SearchResult> {
  const needle = normalizeForSearch(query).norm.trim();
  const words = needle.split(" ").filter(Boolean);
  const none: SearchResult = { mode: "none", total: 0, hits: [] };
  if (needle === "") return none;

  const chapters: { n: number; title: string; body: string }[] = [];
  for (const entry of text.manifest.chapters) {
    chapters.push({ n: entry.n, title: entry.title, body: await text.readChapter(entry.n) });
  }

  const phrase: SearchHit[] = [];
  for (const { n, title, body } of chapters) {
    const { norm, origin } = normalizeForSearch(body);
    for (let at = norm.indexOf(needle); at !== -1; at = norm.indexOf(needle, at + needle.length)) {
      phrase.push({ chapter: n, title, snippet: snippetAt(body, origin[at] ?? 0, query.length) });
    }
  }
  if (phrase.length > 0) return { mode: "phrase", total: phrase.length, hits: phrase };
  if (words.length < 2) return none;

  const lines: SearchHit[] = [];
  for (const { n, title, body } of chapters) {
    let lineStart = 0;
    for (const line of body.split("\n")) {
      const { norm, origin } = normalizeForSearch(line);
      if (words.every((word) => norm.includes(word))) {
        const first = Math.min(...words.map((word) => norm.indexOf(word)));
        const index = lineStart + (origin[first] ?? 0);
        lines.push({ chapter: n, title, snippet: snippetAt(body, index, query.length) });
      }
      lineStart += line.length + 1;
    }
  }
  if (lines.length === 0) return none;
  return { mode: "all-words", total: lines.length, hits: lines };
}
