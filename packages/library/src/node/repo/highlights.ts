/**
 * `data/books/<id>/highlights.json`: the passages highlighted on the Kobo, pulled by `elib sync` (kobo/highlights.ts).
 * Validated with `BookHighlightsSchema`; an invalid file is an `InvalidDataError`, the same as an invalid book.json.
 */
import { BookHighlightsSchema, type BookHighlights } from "../../shared/schema.ts";
import { InvalidDataError } from "./errors.ts";
import { formatJson, readTextIfExists, writeFileAtomic } from "./fs.ts";
import { assertBookId, highlightsPath } from "./paths.ts";

/**
 * Reads `highlights.json` of one book. Null when the file does not exist. Throws `InvalidDataError` when it is not JSON,
 * does not validate, or its `bookId` differs from the folder name.
 */
export async function readBookHighlights(dataDir: string, id: string): Promise<BookHighlights | null> {
  const file = highlightsPath(dataDir, id);
  const text = await readTextIfExists(file);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidDataError(file, `invalid JSON: ${(error as Error).message}`, [], error);
  }
  const parsed = BookHighlightsSchema.safeParse(raw);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  if (parsed.data.bookId !== id) {
    throw new InvalidDataError(
      file,
      `bookId "${parsed.data.bookId}" does not match its folder "${id}"`,
    );
  }
  return parsed.data;
}

/** Validates and writes `highlights.json` atomically (pretty JSON, trailing newline). Returns what was written. */
export async function writeBookHighlights(dataDir: string, highlights: BookHighlights): Promise<BookHighlights> {
  assertBookId(highlights.bookId);
  const file = highlightsPath(dataDir, highlights.bookId);
  const parsed = BookHighlightsSchema.safeParse(highlights);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  await writeFileAtomic(file, formatJson(parsed.data));
  return parsed.data;
}
