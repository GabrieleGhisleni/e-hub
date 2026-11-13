/**
 * Facade of the library for `@ehub/explore` (Node only): the book refs and summaries of the library, the book text
 * of both origins (library and explore), and the storage of the EPUBs imported for an exploration.
 *
 * Explore books live in the cache, next to the library's books, under `explore/books/<id>/` (never in the repo,
 * PLAN §14). Every function takes explicit options for tests; the defaults (data dir, cache dir) come
 * from `loadConfig()`, read only when a default is needed.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { generateBookId, isBookId } from "../../shared/ids.ts";
import type { Book, BookSummary } from "../../shared/schema.ts";
import { bookSlug } from "../../shared/slug.ts";
import { bookHref } from "../../web/lib/format.ts";
import { CACHE_TEXT_DIR, cachedTextDir, ensureDir } from "../cache/index.ts";
import { loadConfig } from "../config/index.ts";
import { extractEpubMetadata } from "../epub/index.ts";
import {
  BookNotFoundError,
  assertBookId,
  listBookIds,
  readAllBooks,
  readBook,
  readBookSummary,
} from "../repo/index.ts";
import { bookTextFromDir, readCachedManifest, type BookText } from "../chat/text.ts";
import {
  assertOutsideRepo,
  extractBookText,
  readManifest,
  writeBookText,
  type TextContext,
  type TextManifest,
} from "../text/index.ts";

export type { BookSummary, BookText, TextManifest };
export { multiBookTools, type MultiBook } from "./multi-tools.ts";

/** A library book as the explorations show it: enough to list it and link to its page. */
export type LibraryBookRef = {
  id: string;
  title: string;
  authors: string[];
  language?: string;
  /** Path of the book page on the site, e.g. `/library/book/<id>/<slug>`. */
  href: string;
};

/** Where a book's text comes from: the library (`elib text` cache) or an EPUB imported for one exploration. */
export type TextOrigin = "library" | "explore";

export type ExploreEpubImport = {
  id: string;
  title: string;
  authors: string[];
  language?: string;
  epub: { fileName: string; md5: string; bytes: number };
  /** Folder of the chapters (`<cache>/explore/books/<id>/text`). */
  textDir: string;
  manifest: TextManifest;
};

/** Name of the folder under the cache that holds the explore books. */
const EXPLORE_DIR = "explore";
const EXPLORE_BOOKS_DIR = "books";
const EXPLORE_EPUB_FILE = "book.epub";
/** Route prefix of the library pages on the site. */
const LIBRARY_ROUTE = "/library";

function dataDirOf(dataDir: string | undefined): string {
  return dataDir ?? loadConfig().dataDir;
}

function cacheDirOf(cacheDir: string | undefined): string {
  return cacheDir ?? loadConfig().cache.dir;
}

/** The text context of the library: the given one, or the configuration with the given cache dir. */
function textContextOf(options: { cacheDir?: string; text?: TextContext }): TextContext {
  if (options.text) return options.text;
  const config = loadConfig();
  return { dataDir: config.dataDir, cacheDir: cacheDirOf(options.cacheDir) };
}

function toRef(book: Book): LibraryBookRef {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    ...(book.language !== undefined ? { language: book.language } : {}),
    href: `${LIBRARY_ROUTE}${bookHref({ id: book.id, slug: bookSlug(book) })}`,
  };
}

/** One library book, or undefined when the ID is invalid or the book does not exist. */
export async function readLibraryBookRef(
  id: string,
  opts: { dataDir?: string } = {},
): Promise<LibraryBookRef | undefined> {
  if (!isBookId(id)) return undefined;
  try {
    return toRef(await readBook(dataDirOf(opts.dataDir), id));
  } catch (error) {
    if (error instanceof BookNotFoundError) return undefined;
    throw error;
  }
}

/** Every valid library book, sorted by title (Italian collation). Folders with a bad book.json are skipped. */
export async function listLibraryBookRefs(
  opts: { dataDir?: string } = {},
): Promise<LibraryBookRef[]> {
  const { books } = await readAllBooks(dataDirOf(opts.dataDir));
  const collator = new Intl.Collator("it", { sensitivity: "base" });
  return books
    .map(toRef)
    .sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
}

/** New book ID, unique among `taken` (the explorations' own books) and the library's folders. */
export async function newExploreBookId(
  taken: ReadonlySet<string>,
  opts: { dataDir?: string } = {},
): Promise<string> {
  const libraryIds = await listBookIds(dataDirOf(opts.dataDir));
  return generateBookId(new Set([...taken, ...libraryIds]));
}

/** `<cache>/explore/books/<id>`. Throws `InvalidBookIdError` for anything that is not a book ID. */
export function exploreBookDir(id: string, opts: { cacheDir?: string } = {}): string {
  assertBookId(id);
  return path.join(cacheDirOf(opts.cacheDir), EXPLORE_DIR, EXPLORE_BOOKS_DIR, id);
}

/** Folder of the chapters of a book: `<cache>/books/<id>/text` (library) or `<cache>/explore/books/<id>/text`. */
export function bookTextDir(
  origin: TextOrigin,
  id: string,
  opts: { cacheDir?: string } = {},
): string {
  if (origin === "library") return cachedTextDir(cacheDirOf(opts.cacheDir), id);
  return path.join(exploreBookDir(id, opts), CACHE_TEXT_DIR);
}

/**
 * Imports an EPUB for an exploration: writes `book.epub` and its chapters (same format as `elib text`) into the
 * explore cache. Title, authors and language come from the EPUB metadata. Refuses output inside the repo.
 */
export async function importExploreEpub(
  input: { id: string; bytes: Uint8Array; fileName: string },
  opts: { cacheDir?: string; repoRoot?: string } = {},
): Promise<ExploreEpubImport> {
  const bookDir = exploreBookDir(input.id, opts);
  const textDir = path.join(bookDir, CACHE_TEXT_DIR);
  const epubFile = path.join(bookDir, EXPLORE_EPUB_FILE);
  await assertOutsideRepo(textDir, opts.repoRoot);
  await assertOutsideRepo(epubFile, opts.repoRoot);

  const meta = await extractEpubMetadata(input.bytes);
  const manifest = await writeBookText(input.bytes, {
    id: input.id,
    title: meta.title,
    authors: meta.authors,
    outputDir: textDir,
    noTextMessage: "L'EPUB non contiene testo leggibile.",
  });
  await ensureDir(bookDir);
  await writeFile(epubFile, input.bytes);

  return {
    id: input.id,
    title: meta.title,
    authors: meta.authors,
    ...(meta.language !== undefined ? { language: meta.language } : {}),
    epub: {
      fileName: input.fileName,
      md5: createHash("md5").update(input.bytes).digest("hex"),
      bytes: input.bytes.byteLength,
    },
    textDir,
    manifest,
  };
}

/**
 * The text of a book, extracting it first when needed. Library: `extractBookText` (reads the cached EPUB).
 * Explore: only the cached chapters; the error tells how to import the EPUB again.
 */
export async function ensureBookText(
  origin: TextOrigin,
  id: string,
  opts: { cacheDir?: string; text?: TextContext } = {},
): Promise<{ textDir: string; manifest: TextManifest }> {
  if (origin === "library") {
    const { outputDir, manifest } = await extractBookText(textContextOf(opts), id);
    return { textDir: outputDir, manifest };
  }
  const textDir = bookTextDir("explore", id, opts);
  const manifest = await readManifest(textDir);
  if (!manifest) {
    throw new Error(
      `Il testo del libro ${id} non è in cache: ricarica l'EPUB con pnpm explore add ${id} --epub <file>.`,
    );
  }
  return { textDir, manifest };
}

/** The cached manifest of a book's text. Never downloads; undefined when the text is not cached or the ID is invalid. */
export async function readCachedBookManifest(
  origin: TextOrigin,
  id: string,
  opts: { cacheDir?: string } = {},
): Promise<TextManifest | undefined> {
  if (!isBookId(id)) return undefined;
  if (origin === "library") return readCachedManifest(cacheDirOf(opts.cacheDir), id);
  return readManifest(bookTextDir("explore", id, opts));
}

/**
 * The text of a library book (`elib text` cache), extracting it first when missing (reads the cached EPUB). The
 * the cache). The text context defaults to the configuration, with the given cache dir.
 */
export async function loadLibraryBookText(
  id: string,
  opts: { cacheDir?: string; text?: TextContext } = {},
): Promise<BookText> {
  const { textDir, manifest } = await ensureBookText("library", id, opts);
  return bookTextFromDir(textDir, manifest);
}

/** The text of a book imported for an exploration, from the cache only. Throws, in Italian, when it is missing. */
export async function loadExploreBookText(
  id: string,
  opts: { cacheDir?: string } = {},
): Promise<BookText> {
  const { textDir, manifest } = await ensureBookText("explore", id, opts);
  return bookTextFromDir(textDir, manifest);
}

/** The LLM summary of a library book (`summary.json`), or null when there is none or the ID is invalid. */
export async function readLibraryBookSummary(
  id: string,
  opts: { dataDir?: string } = {},
): Promise<BookSummary | null> {
  if (!isBookId(id)) return null;
  return readBookSummary(dataDirOf(opts.dataDir), id);
}
