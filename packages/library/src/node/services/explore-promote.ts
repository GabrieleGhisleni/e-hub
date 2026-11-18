/**
 * Promotes a book imported only for an exploration (`<cache>/explore/books/<id>/book.epub`) to a library book, keeping
 * its ID. It goes through the same `analyzeUpload` + `createBook` path as the upload form, so the book gets its
 * book.json, cover, cached EPUB/KEPUB and, last, the KEPUB and series on the Kobo (an explore copy already on the
 * Kobo with the same ID is renamed and updated, reading progress kept). The explore summary, if any, moves to the
 * book's summary.json. The explore cache folder is removed at the end.
 */
import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "@ehub/store";
import path from "node:path";
import type { BookWriteResponse, CoverSource } from "../../shared/api.ts";
import { UNSORTED_TOPIC_ID } from "../../shared/labels.ts";
import { CACHE_EXPLORE_EPUB_FILE, cacheExploreBookDir, isNonEmptyFile } from "../cache/index.ts";
import { reconcileOrQueue } from "../kobo/index.ts";
import { BookNotFoundError, readBook, summaryPath } from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { notFound } from "./errors.ts";
import { assertTopicExists, assertValidBookId, loadTopics } from "./internal.ts";
import { createBook } from "./books.ts";
import { analyzeUpload, stagingDir, writeState } from "./uploads.ts";

const UNKNOWN_AUTHOR = "Autore sconosciuto";

export async function promoteExploreBook(
  ctx: ServiceContext,
  input: { id: string; topic: string },
): Promise<BookWriteResponse> {
  assertValidBookId(input.id);
  assertTopicExists(await loadTopics(ctx), input.topic);

  // Already a library book (an earlier run finished, or another exploration promoted it): just align the Kobo.
  try {
    const book = await readBook(ctx.dataDir, input.id);
    return { book, report: await reconcileOrQueue(ctx.kobo, [book.id]) };
  } catch (error) {
    if (!(error instanceof BookNotFoundError)) throw error;
  }

  const exploreDir = cacheExploreBookDir(ctx.cacheDir, input.id);
  const epub = path.join(exploreDir, CACHE_EXPLORE_EPUB_FILE);
  if (!(await isNonEmptyFile(epub))) {
    throw notFound(
      "not-found",
      `L'EPUB del libro ${input.id} non è nella cache delle esplorazioni: ricaricalo nell'esplorazione.`,
    );
  }

  const analysis = await analyzeUpload(
    ctx,
    { fileName: `${input.id}.epub`, path: epub },
    { openLibrary: "if-no-epub-cover", checkMd5: false },
  );
  // Same ID as in the explorations: createBook reuses the ID reserved in the staging dir.
  await writeState(await stagingDir(ctx, analysis.uploadId), { bookId: input.id, status: "reserved" });

  const ol = analysis.covers.find((c) => c.source === "openlibrary");
  const cover: CoverSource = analysis.covers.some((c) => c.source === "epub")
    ? "epub"
    : ol && !ol.needsConfirmation
      ? "openlibrary"
      : "placeholder";
  const m = analysis.metadata;
  const result = await createBook(ctx, {
    uploadId: analysis.uploadId,
    cover,
    book: {
      title: m.title ?? input.id,
      authors: m.authors.length > 0 ? m.authors : [UNKNOWN_AUTHOR],
      topic: input.topic || UNSORTED_TOPIC_ID,
      status: "to-read",
      ...(m.isbn ? { isbn: m.isbn } : {}),
      ...(m.publisher ? { publisher: m.publisher } : {}),
      ...(m.year !== undefined ? { year: m.year } : {}),
      ...(m.pages !== undefined ? { pages: m.pages } : {}),
      ...(m.translators ? { translators: m.translators } : {}),
      ...(m.language ? { language: m.language } : {}),
      ...(m.description ? { description: m.description } : {}),
      ...(m.subjects.length > 0 ? { subjects: m.subjects } : {}),
    },
  });

  // The summary made for the exploration becomes the book's; then the explore copy is gone (the EPUB is in the
  // library cache now).
  const exploreSummary = path.join(exploreDir, "summary.json");
  if (await isNonEmptyFile(exploreSummary)) {
    // Through the store, so a hosted data dir gets the summary too.
    await readFile(exploreSummary)
      .then((bytes) => writeFileAtomic(summaryPath(ctx.dataDir, input.id), bytes))
      .catch(() => undefined);
  }
  await rm(exploreDir, { recursive: true, force: true });
  ctx.logger.info(`explore book ${input.id} promoted to the library: ${result.book.title}`);
  return result;
}
