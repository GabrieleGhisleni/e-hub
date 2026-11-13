/**
 * Bulk import (`elib import`, PLAN §11, §12 Fase 5): every `*.epub` under a folder becomes a book in "Da smistare"
 * (status to-read, EPUB cover or placeholder) through the same `analyzeUpload` + `createBook` path as the UI.
 * The dry run only extracts and checks: it is the tool to test metadata extraction on real EPUBs (Fase 2).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { CoverSource, DuplicateMatch, ReconcileReport } from "../../shared/api.ts";
import { isBookId } from "../../shared/ids.ts";
import { UNSORTED_TOPIC_ID } from "../../shared/labels.ts";
import { cacheBooksDir, cachedEpubPath, isNonEmptyFile } from "../cache/index.ts";
import { md5File } from "../kobo/index.ts";
import { EpubError, extractEpubMetadata } from "../epub/index.ts";
import { createBook } from "./books.ts";
import type { ServiceContext } from "./context.ts";
import { ServiceError } from "./errors.ts";
import { listDirNames } from "./internal.ts";
import {
  analyzeUpload,
  dropOrphanMd5Matches,
  findReusableStaging,
  fetchOpenLibraryCover,
  findTitleAuthorDuplicates,
} from "./uploads.ts";

/** Author used when the EPUB has none (book.json requires at least one). */
export const UNKNOWN_AUTHOR = "Autore sconosciuto";

export interface ImportScan {
  /** Absolute paths of the EPUBs to import, sorted. */
  epubs: string[];
  /** `*.kepub.epub` files, skipped (the original EPUB is needed). */
  skippedKepubs: string[];
}

/** Recursively lists `*.epub` under `folder` (hidden folders skipped), separating `*.kepub.epub`. */
export async function scanImportFolder(folder: string): Promise<ImportScan> {
  const root = path.resolve(folder);
  const epubs: string[] = [];
  const skippedKepubs: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && /\.kepub\.epub$/i.test(entry.name)) skippedKepubs.push(full);
      else if (entry.isFile() && /\.epub$/i.test(entry.name)) epubs.push(full);
    }
  };
  await visit(root);
  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return { epubs: epubs.sort(byPath), skippedKepubs: skippedKepubs.sort(byPath) };
}

/** A duplicate found by the import: same MD5 as a cached EPUB, as an earlier file of the batch, or same title+author. */
export type ImportDuplicate = DuplicateMatch | { kind: "batch"; file: string };

export interface ImportItem {
  /** Absolute path. */
  file: string;
  /**
   * `ready` (dry run: would be imported), `imported`, `duplicate` (skipped: same file already in the library or earlier
   * in the batch), `invalid` (not a readable EPUB), `failed` (error while creating it).
   */
  status: "ready" | "imported" | "duplicate" | "invalid" | "failed";
  title?: string;
  authors: string[];
  isbn?: string;
  language?: string;
  publisher?: string;
  subjects: number;
  hasDescription: boolean;
  hasEpubCover: boolean;
  /** Cover the book gets (or would get). */
  cover?: CoverSource;
  /** Open Library result (with `--openlibrary`, only for EPUBs without a cover). */
  openLibrary?: { coverId: number; matchedBy: "isbn" | "title-author"; needsConfirmation: boolean };
  duplicates: ImportDuplicate[];
  warnings: string[];
  bookId?: string;
  error?: string;
  report?: ReconcileReport;
}

export interface ImportOptions {
  dryRun?: boolean;
  /** Process at most this many EPUBs (after sorting). */
  limit?: number;
  /** Look up Open Library (throttled) for EPUBs without a cover. */
  openLibrary?: boolean;
  /** Called after each file. */
  onItem?: (item: ImportItem, index: number, total: number) => void;
}

export interface ImportResult {
  dryRun: boolean;
  scanned: number;
  items: ImportItem[];
  skippedKepubs: string[];
  /** Files beyond `limit`. */
  notProcessed: number;
  /** Batch-level problems (e.g. the EPUB cache could not be read: duplicates are then not checked). */
  warnings: string[];
  errors: string[];
}

export async function importFolder(
  ctx: ServiceContext,
  folder: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const dryRun = options.dryRun ?? false;
  const scan = await scanImportFolder(folder);
  const files =
    options.limit !== undefined ? scan.epubs.slice(0, Math.max(0, options.limit)) : scan.epubs;
  const result: ImportResult = {
    dryRun,
    scanned: scan.epubs.length,
    items: [],
    skippedKepubs: scan.skippedKepubs,
    notProcessed: scan.epubs.length - files.length,
    warnings: [],
    errors: [],
  };

  // One MD5 index of the cached EPUBs for the whole batch (not one hash pass per file).
  const cached = await indexCachedEpubs(ctx, result);

  const seen = new Map<string, string>(); // md5 → first file of the batch
  for (const [index, file] of files.entries()) {
    const item = await importOne(ctx, file, {
      dryRun,
      cached,
      seen,
      openLibrary: options.openLibrary ?? false,
    });
    result.items.push(item);
    options.onItem?.(item, index, files.length);
  }
  return result;
}

/**
 * MD5 → cached EPUB paths of every book in the local cache (`<cache>/books/<id>/book.epub`), sorted. Entries whose
 * folder name is not a book ID are skipped. A cache that cannot be read is a batch warning: duplicates are then not
 * checked, the import goes on.
 */
async function indexCachedEpubs(
  ctx: ServiceContext,
  result: ImportResult,
): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  try {
    for (const name of await listDirNames(cacheBooksDir(ctx.cacheDir))) {
      if (!isBookId(name)) continue;
      const epub = cachedEpubPath(ctx.cacheDir, name);
      if (!(await isNonEmptyFile(epub))) continue;
      const md5 = await md5File(epub);
      index.set(md5, [...(index.get(md5) ?? []), epub].sort());
    }
  } catch (error) {
    result.warnings.push(
      `cannot index the EPUB cache: ${(error as Error).message.split("\n")[0]} (duplicates in the library not checked)`,
    );
  }
  return index;
}

async function importOne(
  ctx: ServiceContext,
  file: string,
  opts: {
    dryRun: boolean;
    cached: Map<string, string[]>;
    seen: Map<string, string>;
    openLibrary: boolean;
  },
): Promise<ImportItem> {
  const item: ImportItem = {
    file,
    status: "ready",
    authors: [],
    subjects: 0,
    hasDescription: false,
    hasEpubCover: false,
    duplicates: [],
    warnings: [],
  };

  let metadata;
  try {
    metadata = await extractEpubMetadata(new Uint8Array(await readFile(file)));
  } catch (error) {
    item.status = "invalid";
    item.error = error instanceof EpubError ? error.message : (error as Error).message;
    return item;
  }
  const title =
    metadata.title.trim() ||
    path
      .basename(file)
      .replace(/\.epub$/i, "")
      .trim();
  Object.assign(item, {
    title,
    authors: metadata.authors,
    subjects: metadata.subjects.length,
    hasDescription: Boolean(metadata.description),
    hasEpubCover: Boolean(metadata.cover),
    ...(metadata.isbn ? { isbn: metadata.isbn } : {}),
    ...(metadata.language ? { language: metadata.language } : {}),
    ...(metadata.publisher ? { publisher: metadata.publisher } : {}),
  });
  item.warnings.push(...metadata.warnings);
  if (!metadata.title.trim()) item.warnings.push("title taken from the file name");
  if (metadata.authors.length === 0) item.warnings.push(`no author: "${UNKNOWN_AUTHOR}" is used`);

  // Duplicates: same file already in the cache, or earlier in this batch (skipped); same title+author (warning).
  const md5 = await md5File(file);
  const md5Matches: DuplicateMatch[] = (opts.cached.get(md5) ?? []).map((cachePath) => ({
    kind: "md5",
    path: cachePath,
    bookId: path.basename(path.dirname(cachePath)),
  }));
  // Orphan copies (no book in the repo: a failed earlier import) are not duplicates (R1-03).
  const split = await dropOrphanMd5Matches(ctx, md5Matches);
  item.duplicates.push(...split.duplicates);
  item.warnings.push(...split.warnings);
  const earlier = opts.seen.get(md5);
  if (earlier) item.duplicates.push({ kind: "batch", file: earlier });
  else opts.seen.set(md5, file);
  item.duplicates.push(...(await findTitleAuthorDuplicates(ctx, title, metadata.authors)));
  if (item.duplicates.some((d) => d.kind === "md5" || d.kind === "batch")) {
    item.status = "duplicate";
    return item;
  }

  if (opts.dryRun) {
    item.cover = metadata.cover ? "epub" : "placeholder";
    if (opts.openLibrary && !metadata.cover) {
      const found = await fetchOpenLibraryCover(ctx, {
        ...(metadata.isbn ? { isbn: metadata.isbn } : {}),
        title,
        authors: metadata.authors,
      });
      item.warnings.push(...found.warnings);
      if (found.match) {
        item.openLibrary = {
          coverId: found.match.coverId,
          matchedBy: found.match.matchedBy,
          needsConfirmation: found.match.needsConfirmation,
        };
        if (found.webp && !found.match.needsConfirmation) item.cover = "openlibrary";
      }
    }
    return item;
  }

  let uploadId: string | undefined;
  try {
    // A staging kept by a failed earlier run of the same file is reused: same upload, same reserved book ID, so
    // `createBook` picks up where the earlier run stopped (R1-03).
    const reused = await findReusableStaging(ctx, md5);
    if (reused) item.warnings.push(`resuming an earlier failed import (book ${reused.bookId})`);
    const analysis =
      reused?.analysis ??
      (await analyzeUpload(
        ctx,
        { fileName: path.basename(file), path: file },
        { openLibrary: opts.openLibrary ? "if-no-epub-cover" : "never", checkMd5: false },
      ));
    uploadId = analysis.uploadId;
    const ol = analysis.covers.find((c) => c.source === "openlibrary");
    if (ol?.openLibraryCoverId && ol.matchedBy) {
      item.openLibrary = {
        coverId: ol.openLibraryCoverId,
        matchedBy: ol.matchedBy,
        needsConfirmation: ol.needsConfirmation,
      };
    }
    // EPUB cover; else an Open Library cover found by ISBN; else the placeholder (title+author matches need a human).
    const cover: CoverSource = analysis.covers.some((c) => c.source === "epub")
      ? "epub"
      : ol && !ol.needsConfirmation
        ? "openlibrary"
        : "placeholder";
    item.cover = cover;
    // Extraction warnings are already in the item; keep only the Open Library ones.
    for (const w of analysis.warnings) if (w.startsWith("Open Library")) item.warnings.push(w);
    const m = analysis.metadata;
    const { book, report } = await createBook(ctx, {
      uploadId,
      cover,
      book: {
        title: m.title ?? title,
        authors: m.authors.length > 0 ? m.authors : [UNKNOWN_AUTHOR],
        topic: UNSORTED_TOPIC_ID,
        status: "to-read",
        ...(m.isbn ? { isbn: m.isbn } : {}),
        ...(m.publisher ? { publisher: m.publisher } : {}),
        ...(m.language ? { language: m.language } : {}),
        ...(m.description ? { description: m.description } : {}),
        ...(m.subjects.length > 0 ? { subjects: m.subjects } : {}),
      },
    });
    item.status = "imported";
    item.bookId = book.id;
    item.report = report;
  } catch (error) {
    item.status = "failed";
    item.error = (error as Error).message;
    if (error instanceof ServiceError && error.details && typeof error.details === "object") {
      const report = (error.details as { report?: ReconcileReport }).report;
      if (report) item.report = report;
    }
    // The staging (and its reserved book ID) is kept on purpose: a rerun resumes from it (the 24h cleanup removes
    // it if nobody does).
  }
  return item;
}
