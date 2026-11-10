import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { coverPath, readAllBooks, readBookMarkdown, readTopics } from "../repo/index.ts";
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
}

function coverHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

async function readCover(dataDir: string, id: string): Promise<Buffer | null> {
  try {
    return await readFile(coverPath(dataDir, id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
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

  for (const book of books) {
    if (!topicIds.has(book.topic)) {
      problems.push({ id: book.id, message: `unknown topic "${book.topic}"` });
      continue;
    }
    let coverUrl: string | null = null;
    const bytes = await readCover(dataDir, book.id);
    if (bytes !== null) {
      const fileName = coverFileName(book.id, coverHash(bytes));
      covers.set(fileName, coverPath(dataDir, book.id));
      coverUrl = urls.coverUrl(fileName);
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
    const detail = BookDetailSchema.parse({
      ...card,
      ...optional(
        book,
        "isbn",
        "openLibraryCoverId",
        "publisher",
        "language",
        "description",
        "subjects",
      ),
      notesHtml: renderMarkdown(notes),
      recallHtml: renderMarkdown(recall),
      studyHtml: renderMarkdown(study),
    });
    cards.push(card);
    details.set(book.id, detail);
  }

  const collator = new Intl.Collator("it", { sensitivity: "base" });
  cards.sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));

  const index = SiteIndexSchema.parse({
    topics: topics.map((t) => ({ id: t.id, label: t.label })),
    books: cards,
  });
  return { index, details, covers, problems };
}
