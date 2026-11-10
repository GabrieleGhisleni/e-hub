import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isBookId } from "../../shared/ids.ts";
import { BOOK_KEY_ORDER, type Book, BookSchema } from "../../shared/schema.ts";
import { BookNotFoundError, InvalidDataError } from "./errors.ts";
import { formatJson, isNotFound, readTextIfExists, writeFileAtomic } from "./fs.ts";
import {
  BOOK_JSON,
  type BookMarkdownKind,
  assertBookId,
  bookDir,
  bookJsonPath,
  booksDir,
  markdownPath,
} from "./paths.ts";

export interface InvalidBook {
  /** Folder name under data/books (normally the book ID). */
  id: string;
  file: string;
  message: string;
}

export interface ReadAllBooksResult {
  /** Valid books, sorted by ID. */
  books: Book[];
  /** Folders without book.json (interrupted uploads): skipped, but their IDs stay taken. */
  incomplete: string[];
  /** Folders whose book.json is unreadable or invalid. */
  invalid: InvalidBook[];
}

/** Every folder name under data/books, incomplete ones included (use it for ID uniqueness). Sorted. */
export async function listBookIds(dataDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(booksDir(dataDir), { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

function parseBookJson(file: string, folderId: string, text: string): Book {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidDataError(file, `invalid JSON: ${(error as Error).message}`, [], error);
  }
  const parsed = BookSchema.safeParse(raw);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  if (parsed.data.id !== folderId) {
    throw new InvalidDataError(
      file,
      `id "${parsed.data.id}" does not match its folder "${folderId}"`,
    );
  }
  return parsed.data;
}

/**
 * Reads one book. Throws `BookNotFoundError` when there is no book.json (missing or incomplete folder),
 * `InvalidDataError` when it does not validate or its `id` differs from the folder name.
 */
export async function readBook(dataDir: string, id: string): Promise<Book> {
  const file = bookJsonPath(dataDir, id);
  const text = await readTextIfExists(file);
  if (text === null) throw new BookNotFoundError(id);
  return parseBookJson(file, id, text);
}

/** Reads every book; never throws for a single bad folder (it lands in `incomplete` or `invalid`). */
export async function readAllBooks(dataDir: string): Promise<ReadAllBooksResult> {
  const result: ReadAllBooksResult = { books: [], incomplete: [], invalid: [] };
  for (const name of await listBookIds(dataDir)) {
    const file = path.join(booksDir(dataDir), name, BOOK_JSON);
    if (!isBookId(name)) {
      result.invalid.push({ id: name, file, message: "folder name is not a valid book ID" });
      continue;
    }
    let text: string | null;
    try {
      text = await readTextIfExists(file);
    } catch (error) {
      result.invalid.push({ id: name, file, message: (error as Error).message });
      continue;
    }
    if (text === null) {
      result.incomplete.push(name);
      continue;
    }
    try {
      result.books.push(parseBookJson(file, name, text));
    } catch (error) {
      result.invalid.push({ id: name, file, message: (error as Error).message });
    }
  }
  return result;
}

/**
 * The exact text written to book.json: known keys in `BOOK_KEY_ORDER` (undefined ones skipped),
 * then unknown keys in their original order; 2-space JSON + trailing newline.
 */
export function serializeBook(book: Book): string {
  const known = new Set<string>(BOOK_KEY_ORDER);
  const ordered: Record<string, unknown> = {};
  for (const key of BOOK_KEY_ORDER) {
    if (book[key] !== undefined) ordered[key] = book[key];
  }
  for (const [key, value] of Object.entries(book)) {
    if (!known.has(key) && value !== undefined) ordered[key] = value;
  }
  return formatJson(ordered);
}

/** Validates and writes `data/books/<id>/book.json` atomically (creates the folder). Returns the book. */
export async function writeBook(dataDir: string, book: Book): Promise<Book> {
  assertBookId(book.id);
  const file = bookJsonPath(dataDir, book.id);
  const parsed = BookSchema.safeParse(book);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  await writeFileAtomic(file, serializeBook(book));
  return book;
}

/** Removes `data/books/<id>/` and everything in it (book.json, cover, notes). No-op if missing. */
export async function deleteBookDir(dataDir: string, id: string): Promise<void> {
  await rm(bookDir(dataDir, id), { recursive: true, force: true });
}

/** notes.md / recall.md / study.md contents, or null when the file does not exist. */
export async function readBookMarkdown(
  dataDir: string,
  id: string,
  kind: BookMarkdownKind,
): Promise<string | null> {
  return readTextIfExists(markdownPath(dataDir, id, kind));
}

/** Raw book.json text, or null (useful to check that a file is in canonical format). */
export async function readBookJsonText(dataDir: string, id: string): Promise<string | null> {
  assertBookId(id);
  return readTextIfExists(bookJsonPath(dataDir, id));
}
