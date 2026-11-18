/**
 * Book write operations (PLAN §7): create from a staged upload, edit, bulk edit, delete. Each one edits the repo and
 * then aligns the Kobo through the reconcile logic of src/node/kobo (docs/kobo-ssh-migration.md). The cache is the
 * durable local copy, so a Kobo that is off or not on the Wi-Fi never fails a create or an edit: the report says so
 * (`listing-failed`) and `elib sync` finishes the job later. Delete is the exception: the Kobo has no trash, so a
 * delete that cannot reach the Kobo is refused and the repo is left unchanged.
 */
import { copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  type BookPatch,
  BookPatchSchema,
  type BookWriteResponse,
  type BulkUpdateRequest,
  BulkUpdateRequestSchema,
  type BulkUpdateResponse,
  type CreateBookRequest,
  CreateBookRequestSchema,
  type DeleteBookResponse,
} from "../../shared/api.ts";
import { generateBookId } from "../../shared/ids.ts";
import { type Book, BookSchema } from "../../shared/schema.ts";
import { cachedEpubPath, cachedKepubPath, ensureDir, isNonEmptyFile } from "../cache/index.ts";
import { pushEpub } from "../cache/remote.ts";
import { placeholderCover, saveCover } from "../covers/index.ts";
import { reconcile, removeBookFiles } from "../kobo/index.ts";
import { KepubifyError, convertToKepub } from "../kepub/index.ts";
import {
  BookNotFoundError,
  bookJsonPath,
  deleteBookDir,
  readBook,
  serializeBook,
  writeBook,
} from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { KoboFailedError, ServiceError, badRequest, conflict, notFound } from "./errors.ts";
import {
  assertTopicExists,
  assertValidBookId,
  asWriteError,
  bookFolderExists,
  loadBook,
  loadTopics,
  normalizeForMatch,
  parseInput,
  takenBookIds,
} from "./internal.ts";
import {
  STAGED_EPUB,
  type StagedAnalysis,
  readAnalysis,
  readState,
  removeIncompleteBookDir,
  reservedUploadIds,
  stagedCoverFile,
  stagingDir,
  writeState,
} from "./uploads.ts";

// ---------------------------------------------------------------------------------------------
// Create (PLAN §7.1)
// ---------------------------------------------------------------------------------------------

/**
 * Creates a book from a staged upload, in the order of PLAN §7.1: ID (reserved in the staging dir, so a retry of the
 * same `uploadId` reuses it) → EPUB into the cache + kepubify → `cover.webp` → book.json, written last → Kobo
 * (`reconcile` of the new book: KEPUB upload and series metadata). The Kobo step never fails the create: its errors
 * come back in the report (status 201), e.g. `listing-failed` when the Kobo is off.
 *
 * On a failure before book.json the repo keeps nothing: the book folder (holding only the cover) is removed and the
 * error is thrown. The staging dir, the reserved ID and the cached EPUB/KEPUB stay, so retrying the same request
 * finishes the job with the same ID. A retry after success returns the existing book and aligns the Kobo again.
 */
export async function createBook(
  ctx: ServiceContext,
  request: CreateBookRequest,
): Promise<BookWriteResponse> {
  const req = parseInput(CreateBookRequestSchema, request, "nuovo libro");
  const dir = await stagingDir(ctx, req.uploadId);
  return ctx.lock.runExclusive(() => createBookLocked(ctx, req, dir));
}

async function createBookLocked(
  ctx: ServiceContext,
  req: CreateBookRequest,
  dir: string,
): Promise<BookWriteResponse> {
  const analysis = await readAnalysis(dir);
  const state = await readState(dir);

  // Retry after success (or after a crash right after book.json): answer with the existing book.
  if (
    state &&
    (state.status === "created" || (await isNonEmptyFile(bookJsonPath(ctx.dataDir, state.bookId))))
  ) {
    let book: Book;
    try {
      book = await readBook(ctx.dataDir, state.bookId);
    } catch (error) {
      if (error instanceof BookNotFoundError) {
        throw notFound(
          "upload-not-found",
          "Questo caricamento è già stato usato per un libro che non esiste più: carica di nuovo il file.",
        );
      }
      throw error;
    }
    if (state.status !== "created") await finishStaging(dir, state.bookId);
    return { book, report: await reconcile(ctx.kobo, [book.id]) };
  }

  const topics = await loadTopics(ctx);
  assertTopicExists(topics, req.book.topic);
  const cover = await resolveCreateCover(req, analysis, dir);

  const id = state?.bookId ?? generateBookId(await takenBookIds(ctx, await reservedUploadIds(ctx)));
  if (!state) await writeState(dir, { bookId: id, status: "reserved" });

  const book = parseInput(
    BookSchema,
    { ...req.book, ...cover.bookFields, id },
    "nuovo libro",
  ) as Book;

  try {
    // 1. EPUB into the cache, KEPUB next to it.
    const epub = cachedEpubPath(ctx.cacheDir, id);
    await ensureDir(path.dirname(epub));
    await copyFile(path.join(dir, STAGED_EPUB), epub);
    await pushEpub(ctx.cacheDir, id);
    const kepub = cachedKepubPath(ctx.cacheDir, id);
    if (!(await isNonEmptyFile(kepub))) {
      try {
        await convertToKepub(epub, kepub, ctx.kobo.kepubify);
      } catch (error) {
        if (error instanceof KepubifyError) {
          throw new ServiceError(
            "kepub-failed",
            502,
            `Conversione in KEPUB non riuscita: ${error.message}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
    // 2. Cover.
    const webp =
      cover.file !== null
        ? new Uint8Array(await readFile(cover.file))
        : await placeholderCover({ title: book.title, author: book.authors[0] });
    await saveCover(ctx.dataDir, id, webp);
    // 3. book.json, last: from here the book exists (the cache keeps the files even if the Kobo is unreachable).
    await writeBook(ctx.dataDir, book);
  } catch (error) {
    await removeIncompleteBookDir(ctx, id).catch(() => false);
    throw asWriteError(error);
  }
  await finishStaging(dir, id);
  // 4. Kobo: KEPUB and series metadata. Errors stay in the report; `elib sync` finishes what did not reach the Kobo.
  const report = await reconcile(ctx.kobo, [id]);
  ctx.logger.info(`book ${id} created: ${book.title}`);
  return { book, report };
}

interface CreateCover {
  /** Staged WebP to copy, or null for the placeholder. */
  file: string | null;
  /** Extra book fields implied by the cover choice. */
  bookFields: Partial<Book>;
}

async function resolveCreateCover(
  req: CreateBookRequest,
  analysis: StagedAnalysis,
  dir: string,
): Promise<CreateCover> {
  if (req.cover === "placeholder") return { file: null, bookFields: {} };
  const file = path.join(dir, stagedCoverFile(req.cover));
  if (!(await isNonEmptyFile(file))) {
    throw badRequest(
      "cover-unavailable",
      req.cover === "epub"
        ? "L'EPUB non ha una copertina utilizzabile: scegli un'altra copertina."
        : "Nessuna copertina di Open Library per questo libro: scegline un'altra.",
    );
  }
  if (req.cover === "epub") return { file, bookFields: {} };
  const ol = analysis.openLibrary;
  if (!ol) throw badRequest("cover-unavailable", "Nessuna copertina di Open Library.");
  if (req.openLibraryCoverId !== undefined && req.openLibraryCoverId !== ol.coverId) {
    throw conflict(
      "cover-changed",
      `La copertina di Open Library proposta è la ${ol.coverId}, non la ${req.openLibraryCoverId}.`,
    );
  }
  return {
    file,
    bookFields: {
      openLibraryCoverId: ol.coverId,
      ...(ol.isbn && !req.book.isbn ? { isbn: ol.isbn } : {}),
    },
  };
}

/** Marks the upload as used and drops its big files (analysis + state stay until the 24h cleanup, for retries). */
async function finishStaging(dir: string, bookId: string): Promise<void> {
  await writeState(dir, { bookId, status: "created" });
  await Promise.all(
    [STAGED_EPUB, stagedCoverFile("epub"), stagedCoverFile("openlibrary")].map((name) =>
      rm(path.join(dir, name), { force: true }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Update (PLAN §7.3)
// ---------------------------------------------------------------------------------------------

/** Applies a patch: `null` removes an optional field, `undefined` keeps it; unknown fields are preserved. */
export function applyBookPatch(book: Book, patch: BookPatch): Book {
  const next: Record<string, unknown> = { ...book };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as Book;
}

/** Edits a book's metadata, writes book.json, then reconciles it (files move when topic, title or author change). */
export async function updateBook(
  ctx: ServiceContext,
  id: string,
  patch: BookPatch,
): Promise<BookWriteResponse> {
  assertValidBookId(id);
  const p = parseInput(BookPatchSchema, patch, "modifica libro");
  return ctx.lock.runExclusive(async () => {
    const current = await loadBook(ctx, id);
    if (p.topic !== undefined) assertTopicExists(await loadTopics(ctx), p.topic);
    const next = applyBookPatch(current, p);
    try {
      await writeBook(ctx.dataDir, next);
    } catch (error) {
      throw asWriteError(error);
    }
    return { book: next, report: await reconcile(ctx.kobo, [id]) };
  });
}

// ---------------------------------------------------------------------------------------------
// Bulk update (PLAN §7.4)
// ---------------------------------------------------------------------------------------------

/**
 * Topic / status / tags on many books: every book is checked first (nothing is written when one is missing), then each
 * changed book.json is written, then one reconcile for all of them. Tags compare case- and accent-insensitively:
 * `addTags` skips a tag the book already has in another spelling, `removeTags` removes every spelling.
 */
export async function bulkUpdate(
  ctx: ServiceContext,
  request: BulkUpdateRequest,
): Promise<BulkUpdateResponse> {
  const req = parseInput(BulkUpdateRequestSchema, request, "modifica multipla");
  const ids = [...new Set(req.ids)];
  return ctx.lock.runExclusive(async () => {
    const books: Book[] = [];
    for (const id of ids) books.push(await loadBook(ctx, id));
    if (req.patch.topic !== undefined) assertTopicExists(await loadTopics(ctx), req.patch.topic);

    const updated: Book[] = [];
    for (const book of books) {
      const next = applyBulkPatch(book, req.patch);
      if (serializeBook(next) !== serializeBook(book)) {
        try {
          await writeBook(ctx.dataDir, next);
        } catch (error) {
          throw asWriteError(error);
        }
      }
      updated.push(next);
    }
    return { books: updated, report: await reconcile(ctx.kobo, ids) };
  });
}

export function applyBulkPatch(book: Book, patch: BulkUpdateRequest["patch"]): Book {
  const next: Book = { ...book };
  if (patch.topic !== undefined) next.topic = patch.topic;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.addTags !== undefined || patch.removeTags !== undefined) {
    const remove = new Set((patch.removeTags ?? []).map(normalizeForMatch));
    const tags = (book.tags ?? []).filter((t) => !remove.has(normalizeForMatch(t)));
    const have = new Set(tags.map(normalizeForMatch));
    for (const tag of patch.addTags ?? []) {
      const key = normalizeForMatch(tag);
      if (remove.has(key) || have.has(key)) continue;
      tags.push(tag.trim());
      have.add(key);
    }
    if (tags.length > 0) next.tags = tags;
    else if (book.tags !== undefined) delete next.tags;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Delete (PLAN §7.5)
// ---------------------------------------------------------------------------------------------

/**
 * Removes the book's KEPUB and sidecar folder from the Kobo, then removes `data/books/<id>/` (only when the Kobo step
 * had no errors: otherwise `KoboFailedError` and the repo is unchanged, so the delete can be retried). The Kobo has no
 * trash: the removal is final. An incomplete folder (no book.json) can be deleted too. The cache
 * (`<cache>/books/<id>/`) is kept as the last local copy.
 */
export async function deleteBook(ctx: ServiceContext, id: string): Promise<DeleteBookResponse> {
  assertValidBookId(id);
  return ctx.lock.runExclusive(async () => {
    if (!(await bookFolderExists(ctx, id))) {
      throw notFound("book-not-found", `Libro ${id} non trovato.`);
    }
    const report = await removeBookFiles(ctx.kobo, id);
    if (report.errors.length > 0) {
      throw new KoboFailedError(
        "Il Kobo non è raggiungibile o non ha completato la cancellazione: il libro non è stato eliminato. Accendi il Kobo, collegalo al Wi-Fi e riprova.",
        report,
      );
    }
    await deleteBookDir(ctx.dataDir, id);
    ctx.logger.info(`book ${id} deleted`);
    return { id, report };
  });
}
