/**
 * Upload staging (PLAN §7.1–7.2, §8): the EPUB is parked in `<cache>/uploads/<uploadId>/`, analysed (metadata, cover
 * candidates, duplicates) and kept there until `createBook` uses it, the form is cancelled, or 24h pass.
 *
 * Staging dir layout (owned by this module):
 *   upload.epub              the uploaded file (removed once the book is created)
 *   analysis.json            `StagedAnalysis` (the upload response + what createBook needs)
 *   cover-epub.webp          EPUB cover, already normalized with `toCoverWebp` (= the final cover.webp)
 *   cover-openlibrary.webp   Open Library cover, same
 *   state.json               `{bookId, status}`: the ID reserved by the first createBook attempt (retries reuse it)
 */
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  CandidateSource,
  CoverCandidate,
  DuplicateMatch,
  ExtractedMetadata,
  UploadResponse,
} from "../../shared/api.ts";
import { apiPaths } from "../../shared/api.ts";
import { isBookId } from "../../shared/ids.ts";
import {
  cacheUploadsDir,
  ensureDir,
  isNonEmptyFile,
  isUploadId,
  newUploadId,
  removeCachedBook,
  uploadDir,
} from "../cache/index.ts";
import { toCoverWebp } from "../covers/index.ts";
import { EpubError, type EpubMetadata, extractEpubMetadata } from "../epub/index.ts";
import {
  downloadOpenLibraryCover,
  findOpenLibraryCoverDetailed,
  type OpenLibraryMatch,
} from "../openlibrary/index.ts";
import { findDuplicatesInCache, md5File } from "../kobo/index.ts";
import { readAllBooks } from "../repo/index.ts";
import { bookJsonPath } from "../repo/paths.ts";
import type { ServiceContext } from "./context.ts";
import { badRequest, notFound, tooLarge } from "./errors.ts";
import {
  baseName,
  bookFolderExists,
  listDirNames,
  normalizeForMatch,
  repoBookDir,
} from "./internal.ts";

export const STAGED_EPUB = "upload.epub";
export const ANALYSIS_FILE = "analysis.json";
export const STATE_FILE = "state.json";

export function stagedCoverFile(source: CandidateSource): string {
  return `cover-${source}.webp`;
}

/** What `analyzeUpload` keeps for `createBook`. */
export interface StagedAnalysis extends UploadResponse {
  /** ISO timestamp (staging TTL). */
  createdAt: string;
  /** The Open Library match behind the `openlibrary` candidate. */
  openLibrary?: OpenLibraryMatch & { isbn?: string };
  /** True when the EPUB has a usable cover (`cover-epub.webp`). */
  hasEpubCover: boolean;
}

export interface StagingState {
  bookId: string;
  /** `reserved`: an attempt started (ID taken); `created`: book.json written. */
  status: "reserved" | "created";
}

export interface UploadInput {
  /** Original file name (display, title fallback, `.kepub.epub` check). */
  fileName: string;
  /** File contents (server upload)… */
  bytes?: Uint8Array;
  /** …or a file on disk (`elib import`). */
  path?: string;
}

export interface AnalyzeUploadOptions {
  /** Open Library lookup: always (default, upload form), never, or only when the EPUB has no cover (bulk import). */
  openLibrary?: "always" | "never" | "if-no-epub-cover";
  /** MD5 check against the EPUBs of the cache (default true; `elib import` indexes the cache once for the batch). */
  checkMd5?: boolean;
  /** Page count known from outside the EPUB (Z-Library search result). */
  pages?: number;
}

/**
 * Stages and analyses an EPUB: 413 when too large, 400 `kepub-not-supported` / `not-an-epub` when it cannot be used.
 * Never touches the repo or the Kobo (the cache is only read for the MD5 duplicate check).
 */
export async function analyzeUpload(
  ctx: ServiceContext,
  input: UploadInput,
  options: AnalyzeUploadOptions = {},
): Promise<UploadResponse> {
  const fileName = baseName(input.fileName).trim() || "libro.epub";
  if (/\.kepub\.epub$/i.test(fileName)) {
    throw badRequest(
      "kepub-not-supported",
      `"${fileName}" è un KEPUB: carica l'EPUB originale (il KEPUB viene generato da kepubify).`,
    );
  }
  let bytes: Uint8Array;
  if (input.bytes) {
    bytes = input.bytes;
  } else if (input.path) {
    const info = await stat(input.path);
    if (info.size > ctx.limits.epubMaxBytes) throw tooLargeEpub(ctx, info.size);
    bytes = new Uint8Array(await readFile(input.path));
  } else {
    throw badRequest("invalid-request", "Nessun file caricato.");
  }
  if (bytes.length > ctx.limits.epubMaxBytes) throw tooLargeEpub(ctx, bytes.length);
  if (bytes.length === 0) throw badRequest("not-an-epub", `"${fileName}" è vuoto.`);

  let metadata: EpubMetadata;
  try {
    metadata = await extractEpubMetadata(bytes);
  } catch (error) {
    if (error instanceof EpubError) {
      throw badRequest("not-an-epub", `"${fileName}" non è un EPUB valido: ${error.message}`);
    }
    throw error;
  }

  const uploadId = newUploadId();
  const dir = uploadDir(ctx.cacheDir, uploadId);
  await ensureDir(dir);
  try {
    const stagedEpub = path.join(dir, STAGED_EPUB);
    await writeFile(stagedEpub, bytes);
    const warnings = [...metadata.warnings];

    let title = metadata.title.trim();
    if (!title) {
      title = fileName.replace(/\.epub$/i, "").trim();
      if (title) warnings.push("Titolo preso dal nome del file.");
    }
    const extracted: ExtractedMetadata = {
      ...(title ? { title } : {}),
      authors: metadata.authors,
      subjects: metadata.subjects,
      ...(metadata.isbn ? { isbn: metadata.isbn } : {}),
      ...(metadata.language ? { language: metadata.language } : {}),
      ...(metadata.publisher ? { publisher: metadata.publisher } : {}),
      ...(metadata.year !== undefined ? { year: metadata.year } : {}),
      ...(options.pages !== undefined ? { pages: options.pages } : {}),
      ...(metadata.translators ? { translators: metadata.translators } : {}),
      ...(metadata.description ? { description: metadata.description } : {}),
    };

    const covers: CoverCandidate[] = [];
    let hasEpubCover = false;
    if (metadata.cover) {
      try {
        const webp = await toCoverWebp(metadata.cover.bytes);
        await writeFile(path.join(dir, stagedCoverFile("epub")), webp);
        covers.push({
          source: "epub",
          url: apiPaths.uploadCover(uploadId, "epub"),
          ...(await imageSize(webp)),
          needsConfirmation: false,
        });
        hasEpubCover = true;
      } catch (error) {
        warnings.push(`Copertina dell'EPUB illeggibile: ${(error as Error).message}`);
      }
    } else {
      warnings.push("L'EPUB non contiene una copertina.");
    }

    const lookup = options.openLibrary ?? "always";
    let openLibrary: StagedAnalysis["openLibrary"];
    if (lookup === "always" || (lookup === "if-no-epub-cover" && !hasEpubCover)) {
      const found = await fetchOpenLibraryCover(ctx, {
        ...(extracted.isbn ? { isbn: extracted.isbn } : {}),
        ...(title ? { title } : {}),
        authors: extracted.authors,
      });
      warnings.push(...found.warnings);
      if (found.match && found.webp) {
        await writeFile(path.join(dir, stagedCoverFile("openlibrary")), found.webp);
        openLibrary = {
          ...found.match,
          ...(found.match.matchedBy === "isbn" && extracted.isbn ? { isbn: extracted.isbn } : {}),
        };
        covers.push(openLibraryCandidate(apiPaths.uploadCover(uploadId, "openlibrary"), found));
      }
    }

    const duplicates: DuplicateMatch[] = [];
    if (options.checkMd5 ?? true) {
      try {
        const split = await dropOrphanMd5Matches(
          ctx,
          await findDuplicatesInCache(ctx.cacheDir, stagedEpub),
        );
        duplicates.push(...split.duplicates);
        warnings.push(...split.warnings);
      } catch (error) {
        warnings.push(
          `Controllo duplicati nella cache non riuscito: ${(error as Error).message.split("\n")[0]}`,
        );
      }
    }
    duplicates.push(...(await findTitleAuthorDuplicates(ctx, title, extracted.authors)));

    const response: UploadResponse = {
      uploadId,
      fileName,
      size: bytes.length,
      metadata: extracted,
      covers,
      duplicates,
      warnings,
    };
    const analysis: StagedAnalysis = {
      ...response,
      createdAt: ctx.now().toISOString(),
      hasEpubCover,
      ...(openLibrary ? { openLibrary } : {}),
    };
    await writeFile(path.join(dir, ANALYSIS_FILE), `${JSON.stringify(analysis, null, 2)}\n`);
    return response;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function tooLargeEpub(ctx: ServiceContext, size: number) {
  const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
  return tooLarge(`File troppo grande (${mb(size)}): il limite è ${mb(ctx.limits.epubMaxBytes)}.`);
}

/** Width/height of an encoded image (omitted when sharp cannot tell). */
export async function imageSize(bytes: Uint8Array): Promise<{ width?: number; height?: number }> {
  try {
    const { width, height } = await sharp(bytes).metadata();
    return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
  } catch {
    return {};
  }
}

export interface OpenLibraryCoverResult {
  match: OpenLibraryMatch | null;
  /** The cover normalized with `toCoverWebp` (null when it could not be downloaded). */
  webp: Uint8Array | null;
  warnings: string[];
}

/** Open Library lookup + cover download, throttled by the context's limiter. Never throws. */
export async function fetchOpenLibraryCover(
  ctx: ServiceContext,
  query: { isbn?: string; title?: string; authors?: string[] },
): Promise<OpenLibraryCoverResult> {
  const warnings: string[] = [];
  const opts = { fetch: ctx.fetch, limiter: ctx.openLibraryLimiter };
  if (!query.isbn && !query.title?.trim()) {
    return { match: null, webp: null, warnings: ["Open Library: né ISBN né titolo da cercare."] };
  }
  try {
    const { match, failures } = await findOpenLibraryCoverDetailed(query, opts);
    if (!match) {
      warnings.push(`Open Library: nessuna copertina (${failures.join("; ")}).`);
      return { match: null, webp: null, warnings };
    }
    const failuresOnDownload: string[] = [];
    const bytes = await downloadOpenLibraryCover(match.coverId, {
      ...opts,
      onFailure: (reason) => failuresOnDownload.push(reason),
    });
    if (!bytes) {
      warnings.push(
        `Open Library: copertina ${match.coverId} non scaricabile${failuresOnDownload.length ? ` (${failuresOnDownload.join("; ")})` : ""}.`,
      );
      return { match, webp: null, warnings };
    }
    try {
      return { match, webp: await toCoverWebp(bytes), warnings };
    } catch (error) {
      warnings.push(`Open Library: immagine non valida (${(error as Error).message}).`);
      return { match, webp: null, warnings };
    }
  } catch (error) {
    warnings.push(`Open Library: ${(error as Error).message}`);
    return { match: null, webp: null, warnings };
  }
}

export function openLibraryCandidate(
  url: string,
  found: { match: OpenLibraryMatch | null; webp: Uint8Array | null },
  size: { width?: number; height?: number } = {},
): CoverCandidate {
  const match = found.match!;
  return {
    source: "openlibrary",
    url,
    ...size,
    openLibraryCoverId: match.coverId,
    matchedBy: match.matchedBy,
    ...(match.olTitle ? { title: match.olTitle } : {}),
    ...(match.olAuthors?.length ? { authors: match.olAuthors } : {}),
    needsConfirmation: match.needsConfirmation,
  };
}

/**
 * An MD5 match is a real duplicate only when its book exists in the repo. A match with no book ID, or whose
 * `data/books/<id>/` folder is missing, is an orphan copy (a deleted book whose cache copy was kept, or a failed
 * import): it must not block a new import (R1-03). Returns the remaining duplicates and one warning per orphan.
 */
export async function dropOrphanMd5Matches(
  ctx: ServiceContext,
  matches: readonly DuplicateMatch[],
): Promise<{ duplicates: DuplicateMatch[]; warnings: string[] }> {
  const duplicates: DuplicateMatch[] = [];
  const warnings: string[] = [];
  for (const match of matches) {
    if (match.kind === "md5" && !(match.bookId && (await bookFolderExists(ctx, match.bookId)))) {
      warnings.push(
        `Nella cache c'è già una copia orfana di questo file (${match.path}), senza libro nel repo: ` +
          "viene ignorata.",
      );
    } else {
      duplicates.push(match);
    }
  }
  return { duplicates, warnings };
}

/** Repo books with the same normalized title and an author in common (any author when `authors` is empty). */
export async function findTitleAuthorDuplicates(
  ctx: ServiceContext,
  title: string | undefined,
  authors: readonly string[],
): Promise<DuplicateMatch[]> {
  const wantedTitle = title ? normalizeForMatch(title) : "";
  if (!wantedTitle) return [];
  const wantedAuthors = new Set(authors.map(normalizeForMatch).filter(Boolean));
  const { books } = await readAllBooks(ctx.dataDir);
  return books
    .filter(
      (b) =>
        normalizeForMatch(b.title) === wantedTitle &&
        (wantedAuthors.size === 0 ||
          b.authors.some((a) => wantedAuthors.has(normalizeForMatch(a)))),
    )
    .map((b) => ({ kind: "title-author", bookId: b.id, title: b.title, authors: b.authors }));
}

// ---------------------------------------------------------------------------------------------
// Staging dir access
// ---------------------------------------------------------------------------------------------

/** The staging dir of an existing upload: 404 `upload-not-found` when the ID is invalid or expired. */
export async function stagingDir(ctx: ServiceContext, uploadId: string): Promise<string> {
  if (!isUploadId(uploadId)) throw uploadNotFound();
  const dir = uploadDir(ctx.cacheDir, uploadId);
  if (!(await isNonEmptyFile(path.join(dir, ANALYSIS_FILE)))) throw uploadNotFound();
  return dir;
}

function uploadNotFound() {
  return notFound(
    "upload-not-found",
    "Caricamento non trovato o scaduto (dura 24 ore): carica di nuovo il file.",
  );
}

export async function readAnalysis(dir: string): Promise<StagedAnalysis> {
  return JSON.parse(await readFile(path.join(dir, ANALYSIS_FILE), "utf8")) as StagedAnalysis;
}

export async function readState(dir: string): Promise<StagingState | null> {
  try {
    const state = JSON.parse(await readFile(path.join(dir, STATE_FILE), "utf8")) as StagingState;
    return isBookId(state.bookId) ? state : null;
  } catch {
    return null;
  }
}

export async function writeState(dir: string, state: StagingState): Promise<void> {
  await writeFile(path.join(dir, STATE_FILE), `${JSON.stringify(state)}\n`);
}

/** Candidate image of a staged upload (`image/webp`): 404 when there is none. */
export async function readUploadCover(
  ctx: ServiceContext,
  uploadId: string,
  source: string,
): Promise<Uint8Array> {
  const dir = await stagingDir(ctx, uploadId);
  if (source !== "epub" && source !== "openlibrary") {
    throw notFound("not-found", `Nessuna copertina "${source}" per questo caricamento.`);
  }
  try {
    return new Uint8Array(await readFile(path.join(dir, stagedCoverFile(source))));
  } catch {
    throw notFound("not-found", `Nessuna copertina "${source}" per questo caricamento.`);
  }
}

/**
 * A staging dir that a failed `createBook` left behind for the file with this MD5 (reserved ID, upload.epub still
 * there): `elib import` resumes it instead of starting a new upload.
 */
export async function findReusableStaging(
  ctx: ServiceContext,
  md5: string,
): Promise<{ analysis: StagedAnalysis; bookId: string } | null> {
  for (const name of await listDirNames(cacheUploadsDir(ctx.cacheDir))) {
    if (!isUploadId(name)) continue;
    const dir = uploadDir(ctx.cacheDir, name);
    const state = await readState(dir);
    if (state?.status !== "reserved") continue;
    const staged = path.join(dir, STAGED_EPUB);
    if (!(await isNonEmptyFile(staged))) continue;
    try {
      if ((await md5File(staged)) !== md5) continue;
      return { analysis: await readAnalysis(dir), bookId: state.bookId };
    } catch {
      continue;
    }
  }
  return null;
}

/** IDs reserved by uploads whose book is not created yet (they must not be handed out again). */
export async function reservedUploadIds(ctx: ServiceContext): Promise<string[]> {
  const ids: string[] = [];
  for (const name of await listDirNames(cacheUploadsDir(ctx.cacheDir))) {
    if (!isUploadId(name)) continue;
    const state = await readState(uploadDir(ctx.cacheDir, name));
    if (state) ids.push(state.bookId);
  }
  return ids;
}

/** Cancels an upload (form closed): removes the staging dir and what a failed attempt left behind. */
export async function discardUpload(ctx: ServiceContext, uploadId: string): Promise<void> {
  const dir = await stagingDir(ctx, uploadId);
  await ctx.lock.runExclusive(() => removeStaging(ctx, dir));
}

/**
 * Removes a staging dir. When it reserved a book ID whose book.json was never written, also removes the leftovers of
 * the failed attempt: the cached EPUB/KEPUB and a repo folder holding nothing but the cover. Files that already
 * reached the Kobo stay there and show up as orphans in `elib sync`.
 */
export async function removeStaging(ctx: ServiceContext, dir: string): Promise<void> {
  const state = await readState(dir);
  // Only a `reserved` ID is an unfinished attempt. A `created` one belongs to a book that exists or was deleted:
  // its cache copy is the last local copy of a deleted book (the Kobo has no trash) and must stay (R1-05).
  if (
    state?.status === "reserved" &&
    !(await isNonEmptyFile(bookJsonPath(ctx.dataDir, state.bookId)))
  ) {
    await removeCachedBook(ctx.cacheDir, state.bookId);
    await removeIncompleteBookDir(ctx, state.bookId);
  }
  await rm(dir, { recursive: true, force: true });
}

/**
 * Removes `data/books/<id>/` when it has no book.json and holds only what an upload writes (cover.webp and atomic-write
 * temp files). Anything else (notes written by hand…) keeps the folder: it is reported, never deleted.
 */
export async function removeIncompleteBookDir(ctx: ServiceContext, id: string): Promise<boolean> {
  const dir = repoBookDir(ctx, id);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return false;
  }
  const removable = names.every((n) => n === "cover.webp" || /^\.cover\.webp\..*\.tmp$/.test(n));
  if (!removable) {
    ctx.logger.warn(`data/books/${id}/ has no book.json but other files: left in place`);
    return false;
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Removes staging dirs older than `limits.uploadTtlMs` (server start). Names that are not upload IDs are left alone.
 * Returns how many were removed.
 */
export async function cleanupStaleUploads(ctx: ServiceContext): Promise<number> {
  const now = ctx.now().getTime();
  let removed = 0;
  for (const name of await listDirNames(cacheUploadsDir(ctx.cacheDir))) {
    if (!isUploadId(name)) continue;
    const dir = uploadDir(ctx.cacheDir, name);
    const created = await stagingCreatedAt(dir);
    if (created !== null && now - created < ctx.limits.uploadTtlMs) continue;
    await ctx.lock.runExclusive(() => removeStaging(ctx, dir));
    removed++;
  }
  return removed;
}

async function stagingCreatedAt(dir: string): Promise<number | null> {
  try {
    const analysis = await readAnalysis(dir);
    const time = Date.parse(analysis.createdAt);
    if (!Number.isNaN(time)) return time;
  } catch {
    // no (valid) analysis.json: fall back to the folder's mtime
  }
  try {
    return (await stat(dir)).mtimeMs;
  } catch {
    return null;
  }
}
