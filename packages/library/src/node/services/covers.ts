/**
 * Cover change for an existing book (PLAN §7.3, §8). Candidates live in `<cache>/books/<id>/cover-candidates/`:
 *   epub.webp            the EPUB's cover (from the cached EPUB, downloaded from Drive into the cache when missing)
 *   openlibrary.webp     the Open Library cover, with openlibrary.json (the match)
 * Only the chosen image is copied into the repo as `cover.webp`. Changing the cover never touches Drive.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type BookWriteResponse,
  type CandidateSource,
  type CoverCandidate,
  type CoverCandidatesResponse,
  type SetCoverRequest,
  SetCoverRequestSchema,
  apiPaths,
  emptyReconcileReport,
} from "../../shared/api.ts";
import { expectedDrivePaths } from "../../shared/paths.ts";
import type { Book } from "../../shared/schema.ts";
import { cacheBookDir, cachedEpubPath, isNonEmptyFile } from "../cache/index.ts";
import { placeholderCover, saveCover, toCoverWebp } from "../covers/index.ts";
import { listLibraryFiles } from "../drive/index.ts";
import { extractEpubMetadata } from "../epub/index.ts";
import type { OpenLibraryMatch } from "../openlibrary/index.ts";
import { writeBook } from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { badRequest, conflict, notFound, tooLarge } from "./errors.ts";
import { assertValidBookId, asWriteError, loadBook, loadTopics, parseInput } from "./internal.ts";
import { fetchOpenLibraryCover, imageSize, openLibraryCandidate } from "./uploads.ts";

const CANDIDATES_DIR = "cover-candidates";
const OPEN_LIBRARY_MATCH_FILE = "openlibrary.json";

function candidatesDir(ctx: ServiceContext, id: string): string {
  return path.join(cacheBookDir(ctx.cacheDir, id), CANDIDATES_DIR);
}

function candidateFile(ctx: ServiceContext, id: string, source: CandidateSource): string {
  return path.join(candidatesDir(ctx, id), `${source}.webp`);
}

/**
 * Prepares the cover candidates of an existing book: the EPUB cover and an Open Library lookup (ISBN, else title +
 * author with `needsConfirmation`). Missing candidates are explained in `warnings`. Writes only to the cache.
 */
export async function coverCandidates(
  ctx: ServiceContext,
  id: string,
): Promise<CoverCandidatesResponse> {
  const book = await loadBook(ctx, id);
  const warnings: string[] = [];
  const candidates: CoverCandidate[] = [];

  const epub = await ensureEpubCandidate(ctx, book, warnings, false);
  if (epub) {
    candidates.push({
      source: "epub",
      url: apiPaths.bookCoverCandidate(id, "epub"),
      ...(await imageSize(epub)),
      needsConfirmation: false,
    });
  }

  const ol = await refreshOpenLibraryCandidate(ctx, book, warnings);
  if (ol) {
    candidates.push(
      openLibraryCandidate(
        apiPaths.bookCoverCandidate(id, "openlibrary"),
        { match: ol.match, webp: ol.webp },
        await imageSize(ol.webp),
      ),
    );
  }
  return { candidates, warnings };
}

/** Candidate image (`image/webp`) prepared by `coverCandidates`: 404 when there is none. */
export async function readBookCoverCandidate(
  ctx: ServiceContext,
  id: string,
  source: string,
): Promise<Uint8Array> {
  assertValidBookId(id);
  if (source !== "epub" && source !== "openlibrary") {
    throw notFound("not-found", `Nessuna copertina "${source}" per il libro ${id}.`);
  }
  try {
    return new Uint8Array(await readFile(candidateFile(ctx, id, source)));
  } catch {
    throw notFound(
      "not-found",
      `Nessuna copertina "${source}" pronta per il libro ${id}: richiedi prima le candidate.`,
    );
  }
}

export type SetCoverInput = SetCoverRequest | { image: Uint8Array };

/**
 * Sets `cover.webp` from a source (`epub` / `openlibrary` candidate, computed when missing; `placeholder`) or from an
 * uploaded image. `openlibrary` also stores `openLibraryCoverId` in book.json; other sources leave that field as it is.
 * The report is always empty: covers live only in the repo.
 */
export async function setBookCover(
  ctx: ServiceContext,
  id: string,
  input: SetCoverInput,
): Promise<BookWriteResponse> {
  assertValidBookId(id);
  if ("image" in input) {
    if (input.image.length > ctx.limits.imageMaxBytes) {
      throw tooLarge(
        `Immagine troppo grande: il limite è ${Math.round(ctx.limits.imageMaxBytes / (1024 * 1024))} MB.`,
      );
    }
    let webp: Uint8Array;
    try {
      webp = await toCoverWebp(input.image);
    } catch (error) {
      throw badRequest(
        "invalid-image",
        `Immagine non valida: ${(error as Error).message.split("\n")[0]}`,
      );
    }
    return ctx.lock.runExclusive(async () => {
      const book = await loadBook(ctx, id);
      await saveCover(ctx.dataDir, id, webp);
      return { book, report: emptyReconcileReport() };
    });
  }

  const req = parseInput(SetCoverRequestSchema, input, "copertina");
  return ctx.lock.runExclusive(async () => {
    let book = await loadBook(ctx, id);
    const warnings: string[] = [];
    if (req.source === "placeholder") {
      await saveCover(
        ctx.dataDir,
        id,
        await placeholderCover({ title: book.title, author: book.authors[0] }),
      );
    } else if (req.source === "epub") {
      const webp = await ensureEpubCandidate(ctx, book, warnings, true);
      if (!webp) {
        throw badRequest(
          "cover-unavailable",
          `Copertina dell'EPUB non disponibile: ${warnings.join(" ") || "nessuna immagine"}`,
        );
      }
      await saveCover(ctx.dataDir, id, webp);
    } else {
      const ol =
        (await readOpenLibraryCandidate(ctx, id)) ??
        (await refreshOpenLibraryCandidate(ctx, book, warnings));
      if (!ol) {
        throw badRequest(
          "cover-unavailable",
          `Copertina di Open Library non disponibile: ${warnings.join(" ") || "nessun risultato"}`,
        );
      }
      if (req.openLibraryCoverId !== undefined && req.openLibraryCoverId !== ol.match.coverId) {
        throw conflict(
          "cover-changed",
          `La copertina di Open Library proposta è la ${ol.match.coverId}, non la ${req.openLibraryCoverId}.`,
        );
      }
      await saveCover(ctx.dataDir, id, ol.webp);
      if (book.openLibraryCoverId !== ol.match.coverId) {
        book = { ...book, openLibraryCoverId: ol.match.coverId };
        try {
          await writeBook(ctx.dataDir, book);
        } catch (error) {
          throw asWriteError(error);
        }
      }
    }
    return { book, report: emptyReconcileReport() };
  });
}

/**
 * The EPUB cover as WebP (cached in cover-candidates/epub.webp). Needs the EPUB in the cache: when missing it is
 * downloaded from Drive (the book's `.epub`, expected path first) under the write lock (`locked`: the caller already
 * holds it; the mutex is not reentrant). Null + warning otherwise.
 */
async function ensureEpubCandidate(
  ctx: ServiceContext,
  book: Book,
  warnings: string[],
  locked: boolean,
): Promise<Uint8Array | null> {
  const file = candidateFile(ctx, book.id, "epub");
  if (await isNonEmptyFile(file)) return new Uint8Array(await readFile(file));

  const epub = cachedEpubPath(ctx.cacheDir, book.id);
  if (!(await isNonEmptyFile(epub))) {
    const download = () => downloadEpub(ctx, book, epub, warnings);
    const downloaded = locked ? await download() : await ctx.lock.runExclusive(download);
    if (!downloaded) return null;
  }
  try {
    const metadata = await extractEpubMetadata(epub);
    if (!metadata.cover) {
      warnings.push("L'EPUB non contiene una copertina.");
      return null;
    }
    const webp = await toCoverWebp(metadata.cover.bytes);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, webp);
    return webp;
  } catch (error) {
    warnings.push(`Copertina dell'EPUB illeggibile: ${(error as Error).message.split("\n")[0]}`);
    return null;
  }
}

/** Downloads the book's EPUB from Drive into the cache. Runs under the lock (reconcile may also write there). */
async function downloadEpub(
  ctx: ServiceContext,
  book: Book,
  target: string,
  warnings: string[],
): Promise<boolean> {
  if (await isNonEmptyFile(target)) return true;
  try {
    const files = (await listLibraryFiles(ctx.drive.rclone, ctx.drive.drive)).filter(
      (f) => f.id === book.id && f.kind === "epub",
    );
    if (files.length === 0) {
      warnings.push("L'EPUB non è né nella cache né su Drive.");
      return false;
    }
    let expected: string | undefined;
    try {
      expected = expectedDrivePaths(book, await loadTopics(ctx), ctx.drive.drive).epub;
    } catch {
      expected = undefined;
    }
    const source = files.find((f) => f.path === expected) ?? files[0]!;
    await ctx.drive.rclone.download(source.path, target);
    return true;
  } catch (error) {
    warnings.push(
      `Download dell'EPUB da Drive non riuscito: ${(error as Error).message.split("\n")[0]}`,
    );
    return false;
  }
}

interface StoredOpenLibrary {
  match: OpenLibraryMatch;
  webp: Uint8Array;
}

async function readOpenLibraryCandidate(
  ctx: ServiceContext,
  id: string,
): Promise<StoredOpenLibrary | null> {
  try {
    const dir = candidatesDir(ctx, id);
    const match = JSON.parse(
      await readFile(path.join(dir, OPEN_LIBRARY_MATCH_FILE), "utf8"),
    ) as OpenLibraryMatch;
    const webp = new Uint8Array(await readFile(candidateFile(ctx, id, "openlibrary")));
    return webp.length > 0 && Number.isInteger(match.coverId) ? { match, webp } : null;
  } catch {
    return null;
  }
}

/** New Open Library lookup; replaces (or clears) the stored candidate. */
async function refreshOpenLibraryCandidate(
  ctx: ServiceContext,
  book: Book,
  warnings: string[],
): Promise<StoredOpenLibrary | null> {
  const found = await fetchOpenLibraryCover(ctx, {
    ...(book.isbn ? { isbn: book.isbn } : {}),
    title: book.title,
    authors: book.authors,
  });
  warnings.push(...found.warnings);
  const dir = candidatesDir(ctx, book.id);
  const webpFile = candidateFile(ctx, book.id, "openlibrary");
  const matchFile = path.join(dir, OPEN_LIBRARY_MATCH_FILE);
  if (!found.match || !found.webp) {
    await Promise.all([rm(webpFile, { force: true }), rm(matchFile, { force: true })]);
    return null;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(webpFile, found.webp);
  await writeFile(matchFile, `${JSON.stringify(found.match)}\n`);
  return { match: found.match, webp: found.webp };
}
