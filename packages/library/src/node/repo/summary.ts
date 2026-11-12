/**
 * `data/books/<id>/summary.json`: the LLM summaries of a book (docs/chat.md §4). Validated with `BookSummarySchema`;
 * an invalid file is an `InvalidDataError`, the same as an invalid book.json.
 */
import { BookSummarySchema, type BookSummary } from "../../shared/schema.ts";
import { InvalidDataError } from "./errors.ts";
import { formatJson, readTextIfExists, writeFileAtomic } from "./fs.ts";
import { assertBookId, summaryPath } from "./paths.ts";

/**
 * Reads `summary.json` of one book. Null when the file does not exist. Throws `InvalidDataError` when it is not JSON,
 * does not validate, or its `bookId` differs from the folder name.
 */
export async function readBookSummary(dataDir: string, id: string): Promise<BookSummary | null> {
  const file = summaryPath(dataDir, id);
  const text = await readTextIfExists(file);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidDataError(file, `invalid JSON: ${(error as Error).message}`, [], error);
  }
  const parsed = BookSummarySchema.safeParse(raw);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  if (parsed.data.bookId !== id) {
    throw new InvalidDataError(
      file,
      `bookId "${parsed.data.bookId}" does not match its folder "${id}"`,
    );
  }
  return parsed.data;
}

/** Validates and writes `summary.json` atomically (pretty JSON, trailing newline). Returns the summary. */
export async function writeBookSummary(dataDir: string, summary: BookSummary): Promise<BookSummary> {
  assertBookId(summary.bookId);
  const file = summaryPath(dataDir, summary.bookId);
  const parsed = BookSummarySchema.safeParse(summary);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  await writeFileAtomic(file, formatJson(parsed.data));
  return parsed.data;
}
