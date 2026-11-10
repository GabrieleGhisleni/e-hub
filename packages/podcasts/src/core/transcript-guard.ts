/**
 * Transcript guard (DESIGN.md §5.1). Pure and isomorphic.
 *
 * Finds runs of ≥ 20 consecutive words that also occur consecutively in the
 * episode's local transcript, after normalising case, punctuation and
 * diacritics. Conversations get those runs replaced by a placeholder;
 * summary/notes with a run are rejected by the caller (save.ts).
 *
 * Robust to the compact markdown export (DESIGN.md §4.4, `**Lex** [01:23:45]
 * paragraph…`): timestamps, speaker labels before a timestamp, markdown
 * headings and editor line-number prefixes are "transparent" (skipped when
 * building the word stream), so a pasted export is one continuous run.
 *
 * Speed: the transcript's 20-word shingles are hashed once (word → integer id,
 * then a 32-bit hash per window, verified on hit), so a 60k-word transcript ×
 * a 200 KB conversation takes milliseconds.
 */
import type { TranscriptSegment } from "./schema";

/** Minimum length (in words) of a run that counts as a transcript excerpt. */
export const TRANSCRIPT_EXCERPT_MIN_WORDS = 20;
/** Replaces each excerpt removed from a conversation. */
export const TRANSCRIPT_EXCERPT_PLACEHOLDER = "[estratto della trascrizione rimosso]";
/** Per-conversation size limit (UTF-8 bytes) when there is no local transcript to compare with. */
export const MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT = 200 * 1024;

const PREVIEW_WORDS = 8;

// ---------------------------------------------------------------------------
// Tokenisation

export interface Token {
  /** Normalised word (lowercase, no diacritics, no apostrophes). */
  word: string;
  /** Offsets in the original text: [start, end). */
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’ʼ][\p{L}\p{N}]+)*/gu;
/** Anything but plain ASCII word characters (tokens only contain letters, digits, apostrophes). */
const NEEDS_UNICODE_NORMALIZATION = /[^a-z0-9']/;

/** Regions skipped when building the word stream (see module doc). */
const TRANSPARENT_PATTERNS: readonly RegExp[] = [
  // Timestamps: 01:23, 1:23:45, [01:23:45], (12:34), 00:01:02.500
  /[[(]?\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\b[\])]?/g,
  // Bold speaker label right before a timestamp, anywhere: **Lex Fridman** [01:23:45]
  /\*\*[^*\n]{1,80}\*\*(?=[ \t]*[[(]?\d{1,2}:\d{2})/g,
  // Plain speaker label at line start before a bracketed timestamp: "Lex: [01:23:45]", "- Guest Name [00:01]"
  /^[ \t>]*(?:[-*+][ \t]+)?[*_]{0,2}\p{L}[\p{L}\p{N} .'’-]{0,60}?[*_]{0,2}[ \t]*:?[ \t]*(?=[[(]\d{1,2}:\d{2})/gmu,
  // Markdown headings (chapter titles of the export)
  /^[ \t]{0,3}#{1,6}[ \t][^\n]*$/gm,
  // Line-number prefixes of editor/tool output: "   12→", "12\t"
  /^[ \t]*\d+(?:→|\t)/gm,
];

function transparentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const pattern of TRANSPARENT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0].length > 0) ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function normalizeWord(raw: string): string {
  let word = raw.toLowerCase();
  if (NEEDS_UNICODE_NORMALIZATION.test(word)) word = word.normalize("NFKD").replace(/\p{M}/gu, "");
  return word.replace(/['’ʼ]/g, "");
}

/** Splits text into normalised words with their original offsets, skipping transparent regions. */
export function tokenize(text: string): Token[] {
  const ranges = transparentRanges(text);
  const tokens: Token[] = [];
  let r = 0;
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    while (r < ranges.length && ranges[r]![1] <= start) r++;
    const range = ranges[r];
    if (range && range[0] <= start && start < range[1]) continue;
    const word = normalizeWord(match[0]);
    if (word) tokens.push({ word, start, end: start + match[0].length });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Index

export interface TranscriptIndex {
  /** Number of words in the transcript stream. */
  readonly wordCount: number;
  /** @internal */
  readonly ids: Int32Array;
  /** @internal */
  readonly dictionary: Map<string, number>;
  /** @internal window hash → start positions in `ids` */
  readonly windows: Map<number, number[]>;
  readonly minWords: number;
}

function hashWindow(ids: ArrayLike<number>, start: number, length: number): number {
  let hash = 0x811c9dc5;
  for (let i = start; i < start + length; i++) {
    hash = Math.imul(hash ^ ids[i]!, 0x01000193);
    hash ^= hash >>> 15;
  }
  return hash >>> 0;
}

/**
 * Builds the shingle index of a transcript: its segments' texts concatenated
 * in order (speakers and chapters are not part of the stream). Build it once
 * per save and reuse it for every field.
 */
export function buildTranscriptIndex(
  transcript: { segments: readonly Pick<TranscriptSegment, "text">[] } | string,
  minWords = TRANSCRIPT_EXCERPT_MIN_WORDS,
): TranscriptIndex {
  const texts =
    typeof transcript === "string"
      ? [transcript]
      : transcript.segments.map((segment) => segment.text);
  const dictionary = new Map<string, number>();
  const idList: number[] = [];
  for (const text of texts) {
    for (const token of tokenize(text)) {
      let id = dictionary.get(token.word);
      if (id === undefined) {
        id = dictionary.size;
        dictionary.set(token.word, id);
      }
      idList.push(id);
    }
  }
  const ids = Int32Array.from(idList);
  const windows = new Map<number, number[]>();
  for (let start = 0; start + minWords <= ids.length; start++) {
    const hash = hashWindow(ids, start, minWords);
    const positions = windows.get(hash);
    if (positions) positions.push(start);
    else windows.set(hash, [start]);
  }
  return { wordCount: ids.length, ids, dictionary, windows, minWords };
}

// ---------------------------------------------------------------------------
// Matching

export interface ExcerptSpan {
  /** Character offsets in the checked text: [start, end). */
  start: number;
  end: number;
  /** Words in the run (≥ minWords). */
  wordCount: number;
  /** First few words of the run, for error messages. */
  preview: string;
}

function windowMatches(index: TranscriptIndex, ids: Int32Array, start: number): boolean {
  const positions = index.windows.get(hashWindow(ids, start, index.minWords));
  if (!positions) return false;
  outer: for (const position of positions) {
    for (let k = 0; k < index.minWords; k++) {
      if (index.ids[position + k] !== ids[start + k]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Returns the maximal spans of `text` made of transcript windows (overlapping
 * or adjacent matching windows are merged), in text order.
 */
export function findTranscriptExcerpts(index: TranscriptIndex, text: string): ExcerptSpan[] {
  const { minWords } = index;
  if (index.wordCount < minWords) return [];
  const tokens = tokenize(text);
  if (tokens.length < minWords) return [];

  const ids = new Int32Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) ids[i] = index.dictionary.get(tokens[i]!.word) ?? -1;

  const marked = new Uint8Array(tokens.length);
  let knownRun = 0; // consecutive known ids ending at `end`
  for (let end = 0; end < tokens.length; end++) {
    knownRun = ids[end] === -1 ? 0 : knownRun + 1;
    if (knownRun < minWords) continue;
    const start = end - minWords + 1;
    if (windowMatches(index, ids, start)) marked.fill(1, start, end + 1);
  }

  const spans: ExcerptSpan[] = [];
  for (let i = 0; i < tokens.length;) {
    if (!marked[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < tokens.length && marked[j + 1]) j++;
    const first = tokens[i]!;
    const last = tokens[j]!;
    const previewEnd = tokens[Math.min(j, i + PREVIEW_WORDS - 1)]!.end;
    const preview = text.slice(first.start, previewEnd).replace(/\s+/g, " ");
    spans.push({
      start: first.start,
      end: last.end,
      wordCount: j - i + 1,
      preview: j - i + 1 > PREVIEW_WORDS ? `${preview}…` : preview,
    });
    i = j + 1;
  }
  return spans;
}

/**
 * Replaces every excerpt span with `TRANSCRIPT_EXCERPT_PLACEHOLDER`. A span is
 * widened to swallow a speaker label/timestamp right before it on the same
 * line and closing punctuation right after it, so a pasted export collapses to
 * a single placeholder.
 */
export function redactTranscriptExcerpts(
  index: TranscriptIndex,
  text: string,
): { text: string; removed: number; removedWords: number } {
  const spans = findTranscriptExcerpts(index, text);
  if (spans.length === 0) return { text, removed: 0, removedWords: 0 };
  const ranges = transparentRanges(text);
  let result = "";
  let cursor = 0;
  let removedWords = 0;
  for (const span of spans) {
    let start = span.start;
    // Swallow transparent label/timestamp ranges just before the span, on the same line.
    for (let r = ranges.length - 1; r >= 0; r--) {
      const [rangeStart, rangeEnd] = ranges[r]!;
      if (rangeEnd > start) continue;
      if (rangeStart < cursor || !/^[ \t]*$/.test(text.slice(rangeEnd, start))) break;
      if (text.slice(rangeStart, rangeEnd).includes("\n")) break;
      start = rangeStart;
    }
    let end = span.end;
    while (end < text.length && /[.,;:!?…"'”’)]/.test(text[end]!)) end++;
    result += text.slice(cursor, start) + TRANSCRIPT_EXCERPT_PLACEHOLDER;
    cursor = end;
    removedWords += span.wordCount;
  }
  result += text.slice(cursor);
  return { text: result, removed: spans.length, removedWords };
}

/** UTF-8 size of a string in bytes. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
