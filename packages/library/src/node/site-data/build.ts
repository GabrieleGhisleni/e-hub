import { createHash } from "node:crypto";
import { readBytesIfExists } from "@ehub/store";
import { coverFileName, siteDataUrls } from "../../shared/site-urls.ts";
import { bookSlug } from "../../shared/slug.ts";
import {
  type Book,
  type BookCard,
  BookCardSchema,
  type BookDetail,
  BookDetailSchema,
  type SiteIndex,
  SiteIndexSchema,
} from "../../shared/schema.ts";
import {
  InvalidDataError,
  coverPath,
  readAllBooks,
  readBookMarkdown,
  readBookHighlights,
  readBookSummary,
  readTopics,
} from "../repo/index.ts";
import { renderMarkdown } from "./markdown.ts";

export interface SiteDataProblem {
  /** Book ID / folder name, when the problem concerns one book. */
  id?: string;
  message: string;
}

export interface SiteData {
  index: SiteIndex;
  details: Map<string, BookDetail>;
  /** Published cover file name → absolute source path. */
  covers: Map<string, string>;
  /** Books skipped (invalid, unknown topic, ...). Not fatal. */
  problems: SiteDataProblem[];
}

export interface BuildSiteDataOptions {
  basePath: string;
  /** Absolute prefix of the cover URLs (the hosted API serves them): `<coverBase><file>`. Default: under `basePath`. */
  coverBase?: string;
}

function coverHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

async function readCover(dataDir: string, id: string): Promise<Uint8Array | null> {
  return readBytesIfExists(coverPath(dataDir, id));
}

/** The public part of `summary.json` (no version, no bookId, no `words`). Null when the book has no summary. */
async function publicSummary(
  dataDir: string,
  id: string,
  problems: SiteDataProblem[],
): Promise<BookDetail["summary"]> {
  try {
    const summary = await readBookSummary(dataDir, id);
    if (!summary) return null;
    return {
      language: summary.language,
      model: summary.model,
      generatedAt: summary.generatedAt,
      book: summary.book,
      chapters: summary.chapters.map((c) => ({ n: c.n, title: c.title, summary: c.summary })),
    };
  } catch (error) {
    if (!(error instanceof InvalidDataError)) throw error;
    problems.push({ id, message: `summary.json non valido, pubblicato senza sintesi: ${error.message}` });
    return null;
  }
}

/** The public part of `highlights.json` (no positions or dates). Undefined when the book has none. */
async function publicHighlights(
  dataDir: string,
  id: string,
  problems: SiteDataProblem[],
): Promise<BookDetail["highlights"]> {
  try {
    const file = await readBookHighlights(dataDir, id);
    if (!file || file.highlights.length === 0) return undefined;
    return file.highlights.map((h) => ({
      text: h.text,
      ...(h.note ? { note: h.note } : {}),
      ...(h.chapter ? { chapter: h.chapter } : {}),
      ...(h.page ? { page: h.page } : {}),
    }));
  } catch (error) {
    if (!(error instanceof InvalidDataError)) throw error;
    problems.push({ id, message: `highlights.json non valido, pubblicato senza sottolineature: ${error.message}` });
    return undefined;
  }
}

/** Only the schema's known optional fields, and only when present (unknown keys never get published). */
function optional<K extends keyof Book>(book: Book, ...keys: K[]): Partial<Pick<Book, K>> {
  const out: Partial<Pick<Book, K>> = {};
  for (const key of keys) {
    if (book[key] !== undefined) out[key] = book[key];
  }
  return out;
}

/**
 * Builds everything the public site needs from `data/`: index.json, one detail per valid book and the
 * hashed cover files. Throws if topics.json is missing/invalid; per-book trouble goes to `problems`.
 */
export async function buildSiteData(
  dataDir: string,
  options: BuildSiteDataOptions,
): Promise<SiteData> {
  const urls = siteDataUrls(options.basePath);
  const topics = await readTopics(dataDir);
  const topicIds = new Set(topics.map((t) => t.id));
  const { books, invalid } = await readAllBooks(dataDir);

  const problems: SiteDataProblem[] = invalid.map((b) => ({ id: b.id, message: b.message }));
  const cards: BookCard[] = [];
  const details = new Map<string, BookDetail>();
  const covers = new Map<string, string>();

  // Books are built in parallel (each read is a round trip to the hosted database); the order of `books` is kept.
  const built = await Promise.all(
    books.map(async (book) => {
    if (!topicIds.has(book.topic)) {
      problems.push({ id: book.id, message: `unknown topic "${book.topic}"` });
      return null;
    }
    let coverUrl: string | null = null;
    let coverEntry: [string, string] | null = null;
    const bytes = await readCover(dataDir, book.id);
    if (bytes !== null) {
      const fileName = coverFileName(book.id, coverHash(bytes));
      coverEntry = [fileName, coverPath(dataDir, book.id)];
      coverUrl = options.coverBase === undefined ? urls.coverUrl(fileName) : `${options.coverBase}${fileName}`;
    }

    const card = BookCardSchema.parse({
      id: book.id,
      slug: bookSlug(book),
      title: book.title,
      authors: book.authors,
      topic: book.topic,
      status: book.status,
      tags: book.tags ?? [],
      ...optional(book, "rating", "startedAt", "finishedAt"),
      coverUrl,
    });
    const [notes, recall, study] = await Promise.all([
      readBookMarkdown(dataDir, book.id, "notes"),
      readBookMarkdown(dataDir, book.id, "recall"),
      readBookMarkdown(dataDir, book.id, "study"),
    ]);
    const summary = await publicSummary(dataDir, book.id, problems);
    const highlights = await publicHighlights(dataDir, book.id, problems);
    const detail = BookDetailSchema.parse({
      ...card,
      ...optional(
        book,
        "isbn",
        "openLibraryCoverId",
        "publisher",
        "year",
        "pages",
        "translators",
        "language",
        "description",
        "subjects",
      ),
      notesHtml: renderMarkdown(notes),
      recallHtml: renderMarkdown(recall),
      studyHtml: renderMarkdown(study),
      summary,
      ...(highlights ? { highlights } : {}),
    });
    return { card, detail, coverEntry };
    }),
  );
  for (const item of built) {
    if (!item) continue;
    cards.push(item.card);
    details.set(item.card.id, item.detail);
    if (item.coverEntry) covers.set(item.coverEntry[0], item.coverEntry[1]);
  }


  const collator = new Intl.Collator("it", { sensitivity: "base" });
  cards.sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));

  const index = SiteIndexSchema.parse({
    topics: topics.map((t) => ({ id: t.id, label: t.label })),
    books: cards,
  });
  return { index, details, covers, problems };
}
