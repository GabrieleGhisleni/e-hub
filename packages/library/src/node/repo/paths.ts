import path from "node:path";
import { isBookId } from "../../shared/ids.ts";

/** Markdown files that can sit next to book.json (PLAN §5, §9, §11-bis). */
export type BookMarkdownKind = "notes" | "recall" | "study";

export const BOOK_JSON = "book.json";
export const COVER_FILE = "cover.webp";
/** LLM-written summaries (docs/chat.md §4), written by `elib summarize`. */
export const SUMMARY_FILE = "summary.json";
export const MARKDOWN_FILES: Readonly<Record<BookMarkdownKind, string>> = {
  notes: "notes.md",
  recall: "recall.md",
  study: "study.md",
};

export class InvalidBookIdError extends Error {
  constructor(id: string) {
    super(`invalid book ID ${JSON.stringify(id)}`);
    this.name = "InvalidBookIdError";
  }
}

export function assertBookId(id: string): void {
  if (!isBookId(id)) throw new InvalidBookIdError(id);
}

export function topicsPath(dataDir: string): string {
  return path.join(dataDir, "topics.json");
}

export function booksDir(dataDir: string): string {
  return path.join(dataDir, "books");
}

/** `<dataDir>/books/<id>`. Throws `InvalidBookIdError` for anything that is not a book ID (no path tricks). */
export function bookDir(dataDir: string, id: string): string {
  assertBookId(id);
  return path.join(booksDir(dataDir), id);
}

export function bookJsonPath(dataDir: string, id: string): string {
  return path.join(bookDir(dataDir, id), BOOK_JSON);
}

export function coverPath(dataDir: string, id: string): string {
  return path.join(bookDir(dataDir, id), COVER_FILE);
}

export function markdownPath(dataDir: string, id: string, kind: BookMarkdownKind): string {
  return path.join(bookDir(dataDir, id), MARKDOWN_FILES[kind]);
}

/** `<dataDir>/books/<id>/summary.json`. */
export function summaryPath(dataDir: string, id: string): string {
  return path.join(bookDir(dataDir, id), SUMMARY_FILE);
}

export function notesPath(dataDir: string, id: string): string {
  return markdownPath(dataDir, id, "notes");
}

export function recallPath(dataDir: string, id: string): string {
  return markdownPath(dataDir, id, "recall");
}

export function studyPath(dataDir: string, id: string): string {
  return markdownPath(dataDir, id, "study");
}
