/**
 * The Kobo sleeps almost all the time (docs/hosting.md, "Kobo"). In the hosted setup a change to a book does not fail
 * when the Kobo is off: the book goes into a queue (`<dataDir>/kobo-queue/<bookId>.json`, table `kobo_queue`) and a
 * timer on the Pi drains it with `reconcile` as soon as the Kobo answers. Deletions never pass through the queue and
 * nothing here prunes.
 */
import path from "node:path";
import { listDir, removeFile } from "@ehub/store";
import { z } from "zod";
import {
  type ReconcileReport,
  emptyReconcileReport,
} from "../../shared/api.ts";
import { isBookId } from "../../shared/ids.ts";
import { formatJson, readTextIfExists, writeFileAtomic } from "../repo/fs.ts";
import { BookNotFoundError, readBook } from "../repo/index.ts";
import type { KoboContext } from "./context.ts";
import { reconcile } from "./sync.ts";

export const QUEUE_DIR = "kobo-queue";

export const QueueEntrySchema = z.object({
  bookId: z.string().refine(isBookId),
  queuedAt: z.string(),
  /** Why it is waiting: a failed sync, or the Kobo was off when the change was made. */
  reason: z.enum(["asleep", "failed"]),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

function entryFile(dataDir: string, id: string): string {
  if (!isBookId(id)) throw new Error(`invalid book ID ${JSON.stringify(id)}`);
  return path.join(dataDir, QUEUE_DIR, `${id}.json`);
}

export async function enqueueBooks(
  dataDir: string,
  ids: readonly string[],
  reason: QueueEntry["reason"],
  now = new Date(),
): Promise<void> {
  for (const bookId of ids) {
    const file = entryFile(dataDir, bookId);
    const existing = await readTextIfExists(file);
    // Keep the first time it was queued.
    const queuedAt = existing ? (JSON.parse(existing) as { queuedAt?: string }).queuedAt : undefined;
    await writeFileAtomic(
      file,
      formatJson(QueueEntrySchema.parse({ bookId, queuedAt: queuedAt ?? now.toISOString(), reason })),
    );
  }
}

export async function listQueue(dataDir: string): Promise<QueueEntry[]> {
  const entries = await listDir(path.join(dataDir, QUEUE_DIR));
  const out: QueueEntry[] = [];
  for (const e of entries) {
    if (e.isDirectory || !e.name.endsWith(".json") || e.name.startsWith(".")) continue;
    const text = await readTextIfExists(path.join(dataDir, QUEUE_DIR, e.name));
    const parsed = text ? QueueEntrySchema.safeParse(JSON.parse(text)) : null;
    if (parsed?.success) out.push(parsed.data);
  }
  return out.sort((a, b) => (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0));
}

export async function clearQueue(dataDir: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) await removeFile(entryFile(dataDir, id));
}

/** Books of `ids` that the report could not sync (an error naming the book, or one that names none). */
function failedIds(report: ReconcileReport, ids: readonly string[]): string[] {
  const general = report.errors.some((e) => e.bookId === undefined);
  if (general) return [...ids];
  const named = new Set(report.errors.map((e) => e.bookId));
  return ids.filter((id) => named.has(id));
}

/** True when the Kobo answers (a directory listing over SSH). */
export async function koboReachable(ctx: KoboContext): Promise<boolean> {
  try {
    await ctx.transport.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * What the services call instead of `reconcile`. Without the queue (`ctx.queue` false: tests, local CLI) it is exactly
 * `reconcile`. With it, a Kobo that is off or a failed sync leaves the books in the queue and the report says so.
 */
export async function reconcileOrQueue(
  ctx: KoboContext,
  ids: readonly string[],
): Promise<ReconcileReport> {
  if (!ctx.queue) return reconcile(ctx, ids);
  if (!(await koboReachable(ctx))) {
    await enqueueBooks(ctx.dataDir, ids, "asleep");
    return queuedReport(ids.length);
  }
  const report = await reconcile(ctx, ids);
  const failed = failedIds(report, ids);
  await clearQueue(ctx.dataDir, ids.filter((id) => !failed.includes(id)));
  if (failed.length > 0) await enqueueBooks(ctx.dataDir, failed, "failed");
  return report;
}

function queuedReport(count: number): ReconcileReport {
  const report = emptyReconcileReport();
  report.warnings.push({
    code: "queued",
    message:
      count === 1
        ? "Il Kobo è spento: il libro è in attesa e verrà sincronizzato appena si accende."
        : `Il Kobo è spento: ${count} libri in attesa, verranno sincronizzati appena si accende.`,
  });
  return report;
}

export type DrainStatus = "empty" | "asleep" | "synced" | "partial";

export interface DrainResult {
  status: DrainStatus;
  /** Books that were in the queue when the drain started. */
  pending: number;
  report?: ReconcileReport;
}

/**
 * Empties the queue if the Kobo answers. `resolve` can swap in a context that points at the Kobo's new address
 * (see discovery.ts); it returns null when the Kobo cannot be found. Books that no longer exist are dropped.
 */
export async function drainKoboQueue(
  ctx: KoboContext,
  resolve: (ctx: KoboContext) => Promise<KoboContext | null> = async (c) =>
    (await koboReachable(c)) ? c : null,
): Promise<DrainResult> {
  const queue = await listQueue(ctx.dataDir);
  if (queue.length === 0) return { status: "empty", pending: 0 };
  const live = await resolve(ctx);
  if (!live) return { status: "asleep", pending: queue.length };

  const ids: string[] = [];
  const gone: string[] = [];
  for (const { bookId } of queue) {
    try {
      await readBook(ctx.dataDir, bookId);
      ids.push(bookId);
    } catch (error) {
      if (error instanceof BookNotFoundError) gone.push(bookId);
      else throw error;
    }
  }
  await clearQueue(ctx.dataDir, gone);
  if (ids.length === 0) return { status: "synced", pending: queue.length };
  const report = await reconcile(live, ids);
  const failed = failedIds(report, ids);
  await clearQueue(ctx.dataDir, ids.filter((id) => !failed.includes(id)));
  if (failed.length > 0) await enqueueBooks(ctx.dataDir, failed, "failed");
  return { status: failed.length > 0 ? "partial" : "synced", pending: queue.length, report };
}
