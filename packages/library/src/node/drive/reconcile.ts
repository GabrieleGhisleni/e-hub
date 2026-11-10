/**
 * `reconcile`: make Drive mirror the repo (PLAN §2 "riconciliazione ripetibile", §7, §11). Every write operation of
 * the app edits the repo first and then calls this; `elib sync` is `reconcile(ctx, "all")`. Re-running it after a
 * failure finishes the job, and right after a successful run it plans nothing.
 *
 * Never deletes anything implicitly: only `prune: true` trashes duplicates, orphans and unrecognized files, and files
 * whose ID has a folder in data/books (incomplete uploads, invalid book.json) are never pruned.
 */
import {
  type ReconcileMessage,
  type ReconcileReport,
  emptyReconcileReport,
} from "../../shared/api.ts";
import { isBookId } from "../../shared/ids.ts";
import type { Book, Topic } from "../../shared/schema.ts";
import { isNonEmptyFile } from "../cache/index.ts";
import {
  BookNotFoundError,
  InvalidDataError,
  readAllBooks,
  readBook,
  readTopics,
} from "../repo/index.ts";
import type { DriveContext } from "./context.ts";
import { executePlan } from "./execute.ts";
import { type OrphanScan, planReconcile } from "./plan.ts";
import type { Rclone } from "./rclone.ts";
import { type LibraryFile, listLibraryFiles } from "./remote-index.ts";

export interface ReconcileOptions {
  /** Plan only: no write at all, local or remote. Forced when the context is a dry-run one. */
  dryRun?: boolean;
  /** Trash duplicates, and with target "all" orphans and unrecognized files (`elib sync --prune`). */
  prune?: boolean;
}

/** Internal knobs (topic renames). */
export interface ReconcileInternals {
  /** Rewrites the listing before planning (dry-run topic rename: pretend the folder move happened). */
  transformFiles?: (files: LibraryFile[]) => LibraryFile[];
}

/**
 * Reconciles the given book IDs (read from the repo), or the whole library with `"all"` (= `elib sync`, which also
 * reports orphans and unrecognized files). One listing of the two trees per call.
 */
export async function reconcile(
  ctx: DriveContext,
  target: readonly string[] | "all",
  options: ReconcileOptions = {},
  internals: ReconcileInternals = {},
): Promise<ReconcileReport> {
  const dryRun = isDryRun(ctx, options);
  const report = emptyReconcileReport(dryRun);

  const topics = await loadTopics(ctx, report);
  if (!topics) return report;

  const books: Book[] = [];
  let orphans: OrphanScan | undefined;
  if (target === "all") {
    const all = await readAllBooks(ctx.dataDir);
    books.push(...all.books);
    for (const bad of all.invalid) {
      report.warnings.push({
        code: "invalid-book",
        ...(isBookId(bad.id) ? { bookId: bad.id } : {}),
        path: bad.file,
        message: `${bad.message} (its Drive files are left alone)`,
      });
    }
    orphans = {
      knownIds: new Set([
        ...all.books.map((b) => b.id),
        ...all.incomplete,
        ...all.invalid.map((i) => i.id),
      ]),
      incompleteIds: new Set(all.incomplete),
    };
  } else {
    for (const id of new Set(target)) {
      const book = await loadBook(ctx, id, report);
      if (book) books.push(book);
    }
  }

  return run(ctx, { books, topics, ...(orphans ? { orphans } : {}) }, options, report, internals);
}

/**
 * Reconciles explicit book objects instead of reading them from the repo: for the upload flow, which uploads the
 * cached EPUB/KEPUB before writing book.json (PLAN §7.1). No orphan scan.
 */
export async function reconcileBooks(
  ctx: DriveContext,
  books: readonly Book[],
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const report = emptyReconcileReport(isDryRun(ctx, options));
  const topics = await loadTopics(ctx, report);
  if (!topics) return report;
  return run(ctx, { books: [...books], topics }, options, report, {});
}

export function isDryRun(ctx: DriveContext, options: { dryRun?: boolean }): boolean {
  return ctx.dryRun || options.dryRun === true;
}

/** The context's rclone, or a dry-run copy of it. */
export function rcloneFor(ctx: DriveContext, dryRun: boolean): Rclone {
  return dryRun && !ctx.rclone.dryRun ? ctx.rclone.withDryRun() : ctx.rclone;
}

async function run(
  ctx: DriveContext,
  input: { books: Book[]; topics: Topic[]; orphans?: OrphanScan },
  options: ReconcileOptions,
  report: ReconcileReport,
  internals: ReconcileInternals,
): Promise<ReconcileReport> {
  if (input.books.length === 0 && !input.orphans) return report;
  const rclone = rcloneFor(ctx, report.dryRun);

  let files: LibraryFile[];
  try {
    files = await listLibraryFiles(rclone, ctx.drive);
  } catch (error) {
    report.errors.push(listingFailed(error));
    return report;
  }
  if (internals.transformFiles) files = internals.transformFiles(files);

  const plan = await planReconcile({
    drive: ctx.drive,
    cacheDir: ctx.cacheDir,
    topics: input.topics,
    books: input.books,
    files,
    prune: options.prune === true,
    ...(input.orphans ? { orphans: input.orphans } : {}),
    cacheHas: isNonEmptyFile,
  });
  report.warnings.push(...plan.warnings);
  report.errors.push(...plan.errors);
  await executePlan(plan.steps, report, { ctx, rclone, dryRun: report.dryRun, files });
  return report;
}

export function listingFailed(error: unknown): ReconcileMessage {
  return {
    code: "listing-failed",
    message: `cannot list the Drive trees, nothing was done: ${(error as Error).message}`,
  };
}

async function loadTopics(ctx: DriveContext, report: ReconcileReport): Promise<Topic[] | null> {
  try {
    return await readTopics(ctx.dataDir);
  } catch (error) {
    report.errors.push({
      code: "invalid-topics",
      message: `cannot read topics.json, nothing was done: ${(error as Error).message}`,
    });
    return null;
  }
}

async function loadBook(
  ctx: DriveContext,
  id: string,
  report: ReconcileReport,
): Promise<Book | null> {
  if (!isBookId(id)) {
    report.errors.push({
      code: "invalid-book-id",
      message: `not a book ID: ${JSON.stringify(id)}`,
    });
    return null;
  }
  try {
    return await readBook(ctx.dataDir, id);
  } catch (error) {
    if (error instanceof BookNotFoundError) {
      report.errors.push({
        code: "book-not-found",
        bookId: id,
        message: `book ${id} has no book.json (missing or unfinished upload): its Drive files are left alone`,
      });
    } else if (error instanceof InvalidDataError) {
      report.errors.push({
        code: "invalid-book",
        bookId: id,
        path: error.file,
        message: `${error.message} (its Drive files are left alone)`,
      });
    } else {
      report.errors.push({
        code: "read-failed",
        bookId: id,
        message: `cannot read book ${id}: ${(error as Error).message}`,
      });
    }
    return null;
  }
}
