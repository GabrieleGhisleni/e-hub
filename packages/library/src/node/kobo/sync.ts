/**
 * `reconcile`: make the Kobo mirror the repo (docs/kobo-ssh-migration.md). Every write
 * operation of the app edits the repo first and then calls this; `elib sync` is `reconcile(ctx, "all")`. Re-running
 * it after a failure finishes the job, and right after a successful run it plans nothing.
 *
 * Per book: the KEPUB at its expected name, the KOReader sidecar folder `<name>.kepub.sdr/` (reading progress lives
 * there: renames move the whole folder) and its `custom_metadata.lua` (series = topic label). Files are recognized by
 * the `[<id>]` in their name; anything else on the Kobo is never touched.
 *
 * Never deletes anything implicitly: only `prune: true` removes duplicates and orphans. Files whose ID has a folder in
 * data/books (incomplete uploads, invalid book.json) are never removed.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  type ReconcileAction,
  type ReconcileMessage,
  type ReconcileReport,
  emptyReconcileReport,
} from "../../shared/api.ts";
import { isBookId } from "../../shared/ids.ts";
import {
  KOBO_SIDECAR_METADATA_FILE,
  type KoboEntryKind,
  koboFileName,
  parseKoboFileName,
} from "../../shared/naming.ts";
import type { Book, Topic } from "../../shared/schema.ts";
import {
  CACHE_EXPLORE_DIR,
  cachedEpubPath,
  cachedKepubPath,
  isNonEmptyFile,
} from "../cache/index.ts";
import { ensureCachedEpub } from "../cache/remote.ts";
import { KepubifyError, convertToKepub } from "../kepub/index.ts";
import {
  BookNotFoundError,
  InvalidDataError,
  assertBookId,
  readAllBooks,
  readBook,
  readTopics,
} from "../repo/index.ts";
import type { KoboContext } from "./context.ts";
import { sidecarContent, sidecarMetadataPath } from "./sidecar.ts";
import { SshError } from "./ssh.ts";
import { type KoboEntry, UnsafeKoboPathError } from "./transport.ts";

export interface ReconcileOptions {
  /** Plan only: no write at all, on the Kobo or in the cache. Forced when the context is a dry-run one. */
  dryRun?: boolean;
  /** Delete duplicates, and with target "all" orphans (`elib sync --prune`). Deleting on the Kobo is irreversible. */
  prune?: boolean;
}

/** A KEPUB or sidecar entry recognized by its name and type. */
interface Managed {
  name: string;
  id: string;
  kind: KoboEntryKind;
}

/** A planned write or removal; `run` is never called in a dry run. */
interface Op {
  action: ReconcileAction;
  /** For failure messages, e.g. `rename A → B`. */
  describe: string;
  run: () => Promise<void>;
  /** Called when `run` fails (a failed sidecar rename blocks that book's metadata write). */
  onFailure?: () => void;
}

interface RunInput {
  books: Book[];
  topics: Topic[];
  orphans?: { knownIds: ReadonlySet<string>; incompleteIds: ReadonlySet<string> };
}

/** IDs of the books imported for explorations (folders of `<cache>/explore/books`); [] when there are none. */
export async function listExploreBookIds(cacheDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(cacheDir, CACHE_EXPLORE_DIR, "books"), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory() && isBookId(e.name)).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Reconciles the given book IDs (read from the repo), or the whole library with `"all"` (= `elib sync`, which also
 * reports orphans and unrecognized files). One listing of the Kobo per call.
 */
export async function reconcile(
  ctx: KoboContext,
  target: readonly string[] | "all",
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const report = emptyReconcileReport(isDryRun(ctx, options));
  const topics = await loadTopics(ctx, report);
  if (!topics) return report;

  const books: Book[] = [];
  let orphans: RunInput["orphans"];
  if (target === "all") {
    const all = await readAllBooks(ctx.dataDir);
    books.push(...all.books);
    for (const bad of all.invalid) {
      report.warnings.push({
        code: "invalid-book",
        ...(isBookId(bad.id) ? { bookId: bad.id } : {}),
        path: bad.file,
        message: `${bad.message} (its Kobo files are left alone)`,
      });
    }
    orphans = {
      knownIds: new Set([
        ...all.books.map((b) => b.id),
        ...all.incomplete,
        ...all.invalid.map((i) => i.id),
        // Books imported for explorations may be on the Kobo too: never orphans.
        ...(await listExploreBookIds(ctx.cacheDir)),
      ]),
      incompleteIds: new Set(all.incomplete),
    };
  } else {
    for (const id of new Set(target)) {
      const book = await loadBook(ctx, id, report);
      if (book) books.push(book);
    }
  }

  return run(ctx, { books, topics, ...(orphans ? { orphans } : {}) }, options, report);
}

/**
 * Reconciles explicit book objects instead of reading them from the repo: for the upload flow, which uploads the
 * cached EPUB/KEPUB before writing book.json. No orphan scan.
 */
export async function reconcileBooks(
  ctx: KoboContext,
  books: readonly Book[],
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const report = emptyReconcileReport(isDryRun(ctx, options));
  const topics = await loadTopics(ctx, report);
  if (!topics) return report;
  return run(ctx, { books: [...books], topics }, options, report);
}

/**
 * Removes every KEPUB and sidecar folder of one book from the Kobo (the book was deleted from the repo). Irreversible:
 * the Kobo has no trash. The local cache keeps the last copy.
 */
export async function removeBookFiles(
  ctx: KoboContext,
  id: string,
  options: { dryRun?: boolean } = {},
): Promise<ReconcileReport> {
  assertBookId(id);
  const dryRun = isDryRun(ctx, options);
  const report = emptyReconcileReport(dryRun);

  let entries: KoboEntry[];
  try {
    entries = await ctx.transport.list();
  } catch (error) {
    report.errors.push(listingFailed(ctx, error));
    return report;
  }

  const ops = managedEntries(entries)
    .filter((entry) => entry.id === id)
    .map((entry) => removeOp(ctx, entry.name, id));
  if (ops.length === 0) {
    report.warnings.push({
      code: "no-files",
      bookId: id,
      message: `no files of book ${id} on the Kobo: nothing to remove`,
    });
    return report;
  }
  for (const op of ops) report.actions.push(op.action);
  const succeeded = await execute(ops, report, dryRun);
  if (!dryRun && succeeded > 0) await flushKobo(ctx, report);
  return report;
}

export function isDryRun(ctx: KoboContext, options: { dryRun?: boolean }): boolean {
  return ctx.dryRun || options.dryRun === true;
}

async function run(
  ctx: KoboContext,
  input: RunInput,
  options: ReconcileOptions,
  report: ReconcileReport,
): Promise<ReconcileReport> {
  if (input.books.length === 0 && !input.orphans) return report;
  const prune = options.prune === true;

  let entries: KoboEntry[];
  try {
    entries = await ctx.transport.list();
  } catch (error) {
    report.errors.push(listingFailed(ctx, error));
    return report;
  }

  const managed = managedEntries(entries);
  const byId = new Map<string, { kepub: Managed[]; sidecar: Managed[] }>();
  for (const entry of managed) {
    const slot = byId.get(entry.id) ?? { kepub: [], sidecar: [] };
    (entry.kind === "kepub" ? slot.kepub : slot.sidecar).push(entry);
    byId.set(entry.id, slot);
  }
  const topicLabels = new Map(input.topics.map((t) => [t.id, t.label]));

  const renames: Op[] = [];
  const uploads: Op[] = [];
  const removals: Op[] = [];
  /** Books whose sidecar folder could not be renamed: their metadata must not start a new folder. */
  const failedSidecars = new Set<string>();
  const metadataPending: { currentPath: string; to: string; content: string; bookId: string }[] =
    [];

  for (const book of input.books) {
    const label = topicLabels.get(book.topic);
    if (label === undefined) {
      report.errors.push({
        code: "unknown-topic",
        bookId: book.id,
        message: `book ${book.id} has topic "${book.topic}", which is not in topics.json: its Kobo files are left alone`,
      });
      continue;
    }

    const expectedKepub = koboFileName(book, "kepub");
    const expectedSidecar = koboFileName(book, "sidecar");
    const found = byId.get(book.id) ?? { kepub: [], sidecar: [] };

    // KEPUB: keep the expected name; else rename the first copy; else upload it from the cache.
    const kepubNames = found.kepub.map((e) => e.name);
    if (kepubNames.includes(expectedKepub)) {
      planExtras(
        report,
        removals,
        ctx,
        book.id,
        "kepub",
        kepubNames.filter((n) => n !== expectedKepub),
        prune,
      );
    } else if (kepubNames.length > 0) {
      const [first, ...extras] = kepubNames as [string, ...string[]];
      renames.push(renameOp(ctx, first, expectedKepub, book.id, "kepub"));
      planExtras(report, removals, ctx, book.id, "kepub", extras, prune);
    } else {
      const upload = await planUpload(ctx, report, book, expectedKepub);
      if (!upload) continue; // no copy anywhere: the sidecar waits for a run that can upload the book
      uploads.push(upload);
    }

    // Sidecar folder: same rule. Its current name is where the metadata is read from (before the rename).
    const sidecarNames = found.sidecar.map((e) => e.name);
    let currentSidecar = expectedSidecar;
    if (sidecarNames.includes(expectedSidecar)) {
      planExtras(
        report,
        removals,
        ctx,
        book.id,
        "sidecar",
        sidecarNames.filter((n) => n !== expectedSidecar),
        prune,
      );
    } else if (sidecarNames.length > 0) {
      const [first, ...extras] = sidecarNames as [string, ...string[]];
      renames.push(renameOp(ctx, first, expectedSidecar, book.id, "sidecar", failedSidecars));
      currentSidecar = first;
      planExtras(report, removals, ctx, book.id, "sidecar", extras, prune);
    }

    metadataPending.push({
      bookId: book.id,
      currentPath: `${currentSidecar}/${KOBO_SIDECAR_METADATA_FILE}`,
      to: sidecarMetadataPath(book),
      content: sidecarContent(book, label),
    });
  }

  if (input.orphans) {
    const { knownIds, incompleteIds } = input.orphans;
    for (const entry of managed) {
      if (incompleteIds.has(entry.id)) {
        report.warnings.push({
          code: "incomplete-upload",
          bookId: entry.id,
          path: entry.name,
          message: `"${entry.name}" belongs to an unfinished upload (data/books/${entry.id}/ has no book.json): left alone, never removed`,
        });
      } else if (!knownIds.has(entry.id)) {
        report.warnings.push({
          code: "orphan-file",
          bookId: entry.id,
          path: entry.name,
          message: `"${entry.name}" belongs to no book in the repo${prune ? "" : "; `elib sync --prune` deletes it from the Kobo (irreversible)"}`,
        });
        if (prune) removals.push(removeOp(ctx, entry.name, entry.id));
      }
    }
  }

  // Metadata: one hash call for every file, against the names they have now (before this run's renames).
  const metadataOps: Op[] = [];
  if (metadataPending.length > 0) {
    try {
      const current = await ctx.transport.md5(metadataPending.map((m) => m.currentPath));
      for (const pending of metadataPending) {
        if (current.get(pending.currentPath) === md5Text(pending.content)) continue;
        metadataOps.push(metadataOp(ctx, pending, failedSidecars));
      }
    } catch (error) {
      report.errors.push({
        code: errorCode(error),
        message: `cannot read the metadata files on the Kobo, they are left as they are: ${messageOf(error)}`,
      });
    }
  }

  const ordered = [...renames, ...uploads, ...metadataOps, ...removals];
  for (const op of ordered) report.actions.push(op.action);
  const succeeded = await execute(ordered, report, report.dryRun);
  if (!report.dryRun && succeeded > 0) await flushKobo(ctx, report);
  return report;
}

// ---------------------------------------------------------------------------------------------
// Planning helpers
// ---------------------------------------------------------------------------------------------

/** Entries that are ours: a KEPUB is a file, a sidecar is a folder. Anything else is unmanaged and ignored. */
function managedEntries(entries: readonly KoboEntry[]): Managed[] {
  const managed: Managed[] = [];
  for (const entry of entries) {
    const parsed = parseKoboFileName(entry.name);
    if (!parsed) continue;
    if ((parsed.kind === "sidecar") !== entry.dir) continue;
    managed.push({ name: entry.name, id: parsed.id, kind: parsed.kind });
  }
  return managed;
}

/** Extra copies of a KEPUB or sidecar: a warning each, a removal with `prune`. */
function planExtras(
  report: ReconcileReport,
  removals: Op[],
  ctx: KoboContext,
  bookId: string,
  kind: KoboEntryKind,
  extras: readonly string[],
  prune: boolean,
): void {
  const label = kind === "kepub" ? "KEPUB" : "sidecar folder";
  for (const name of extras) {
    report.warnings.push({
      code: "duplicate-file",
      bookId,
      path: name,
      message: `extra ${label} of book ${bookId}${prune ? "" : "; `elib sync --prune` deletes it from the Kobo (irreversible)"}`,
    });
    if (prune) removals.push(removeOp(ctx, name, bookId));
  }
}

/** Upload of a KEPUB from the cache, regenerated with kepubify from the cached EPUB when needed. Null: nothing to upload. */
async function planUpload(
  ctx: KoboContext,
  report: ReconcileReport,
  book: Book,
  expectedKepub: string,
): Promise<Op | null> {
  const cacheKepub = cachedKepubPath(ctx.cacheDir, book.id);
  const cacheEpub = cachedEpubPath(ctx.cacheDir, book.id);
  let regenerate = false;
  if (!(await isNonEmptyFile(cacheKepub))) {
    if (!(await ensureCachedEpub(ctx.cacheDir, book.id))) {
      report.errors.push({
        code: "missing-in-cache",
        bookId: book.id,
        path: expectedKepub,
        message: `book ${book.id}: no EPUB/KEPUB in the cache: cannot upload it to the Kobo`,
      });
      return null;
    }
    regenerate = true;
    report.warnings.push({
      code: "kepub-regenerated",
      bookId: book.id,
      path: expectedKepub,
      message: `KEPUB of book ${book.id} missing on the Kobo and in the cache: regenerated with kepubify from the cached EPUB`,
    });
  }
  return {
    action: {
      type: "upload",
      status: "planned",
      bookId: book.id,
      from: cacheKepub,
      to: expectedKepub,
    },
    describe: `upload ${cacheKepub} → ${expectedKepub}`,
    run: async () => {
      if (regenerate) await convertToKepub(cacheEpub, cacheKepub, ctx.kepubify);
      await ctx.transport.upload(cacheKepub, expectedKepub);
    },
  };
}

function renameOp(
  ctx: KoboContext,
  from: string,
  to: string,
  bookId: string,
  kind: KoboEntryKind,
  failedSidecars?: Set<string>,
): Op {
  return {
    action: { type: "rename", status: "planned", bookId, from, to },
    describe: `rename ${from} → ${to}`,
    run: () => ctx.transport.rename(from, to),
    ...(kind === "sidecar" && failedSidecars
      ? { onFailure: () => failedSidecars.add(bookId) }
      : {}),
  };
}

function removeOp(ctx: KoboContext, name: string, bookId: string): Op {
  return {
    action: { type: "remove", status: "planned", bookId, from: name },
    describe: `remove ${name}`,
    run: () => ctx.transport.remove(name),
  };
}

function metadataOp(
  ctx: KoboContext,
  pending: { bookId: string; to: string; content: string },
  failedSidecars: Set<string>,
): Op {
  return {
    action: { type: "metadata", status: "planned", bookId: pending.bookId, to: pending.to },
    describe: `write ${pending.to}`,
    run: async () => {
      if (failedSidecars.has(pending.bookId)) {
        throw new Error("its sidecar folder could not be renamed, so the metadata is not written");
      }
      await ctx.transport.writeFile(pending.to, pending.content);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

/**
 * Runs the ops in order, each on its own: a failed one is reported and the others still run. Returns how many
 * succeeded. Dry run: nothing runs, the actions stay `planned`.
 */
async function execute(
  ops: readonly Op[],
  report: ReconcileReport,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return 0;
  let succeeded = 0;
  for (const op of ops) {
    try {
      await op.run();
      op.action.status = "done";
      succeeded += 1;
    } catch (error) {
      op.action.status = "failed";
      op.onFailure?.();
      report.errors.push({
        code: errorCode(error),
        message: `${op.describe} failed: ${messageOf(error)}`,
        ...(op.action.bookId ? { bookId: op.action.bookId } : {}),
        path: op.action.to ?? op.action.from ?? "",
      });
    }
  }
  return succeeded;
}

async function flushKobo(ctx: KoboContext, report: ReconcileReport): Promise<void> {
  try {
    await ctx.transport.flush();
  } catch (error) {
    report.warnings.push({
      code: "flush-failed",
      message: `the Kobo did not confirm the writes (sync): they may show up only after a reboot. ${messageOf(error)}`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function md5Text(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof SshError) return "ssh-failed";
  if (error instanceof KepubifyError) return "kepub-failed";
  if (error instanceof UnsafeKoboPathError) return "unsafe-path";
  return "action-failed";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listingFailed(ctx: KoboContext, error: unknown): ReconcileMessage {
  return {
    code: "listing-failed",
    message: `cannot reach the Kobo (${ctx.transport.description}), nothing was done: ${messageOf(error)}`,
  };
}

async function loadTopics(ctx: KoboContext, report: ReconcileReport): Promise<Topic[] | null> {
  try {
    return await readTopics(ctx.dataDir);
  } catch (error) {
    report.errors.push({
      code: "invalid-topics",
      message: `cannot read topics.json, nothing was done: ${messageOf(error)}`,
    });
    return null;
  }
}

async function loadBook(
  ctx: KoboContext,
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
        message: `book ${id} has no book.json (missing or unfinished upload): its Kobo files are left alone`,
      });
    } else if (error instanceof InvalidDataError) {
      report.errors.push({
        code: "invalid-book",
        bookId: id,
        path: error.file,
        message: `${error.message} (its Kobo files are left alone)`,
      });
    } else {
      report.errors.push({
        code: "read-failed",
        bookId: id,
        message: `cannot read book ${id}: ${messageOf(error)}`,
      });
    }
    return null;
  }
}
