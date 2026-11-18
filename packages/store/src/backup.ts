/**
 * Nightly backup (docs/hosting.md): every table as one gzipped JSON on R2, `backups/<date>.json.gz`, the last 30 kept.
 * Independent of the database vendor: a dump of what the app stores, and `restoreBackup` puts it back.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { BlobStore } from "./blobs.ts";
import type { Doc, DocClient } from "./docs.ts";

/** Every table of turso/migrations. */
export const TABLES = [
  "books",
  "book_summaries",
  "book_highlights",
  "book_markdown",
  "topics",
  "shows",
  "episodes",
  "conversations",
  "notes",
  "explorations",
  "chats",
  "kobo_queue",
] as const;

export const BACKUP_PREFIX = "backups/";
export const BACKUP_KEEP = 30;

export interface BackupFile {
  version: 1;
  createdAt: string;
  tables: Record<string, Doc[]>;
}

export function backupKey(date: Date): string {
  return `${BACKUP_PREFIX}${date.toISOString().slice(0, 10)}.json.gz`;
}

export async function createBackup(docs: DocClient, now = new Date()): Promise<BackupFile> {
  const tables: Record<string, Doc[]> = {};
  for (const table of TABLES) tables[table] = await docs.list(table);
  return { version: 1, createdAt: now.toISOString(), tables };
}

export interface BackupResult {
  key: string;
  documents: number;
  bytes: number;
  deleted: string[];
}

/** Dumps, uploads, then removes the backups beyond the newest `keep` (names sort by date). */
export async function runBackup(
  docs: DocClient,
  blobs: BlobStore,
  now = new Date(),
  keep = BACKUP_KEEP,
): Promise<BackupResult> {
  const file = await createBackup(docs, now);
  const body = new Uint8Array(gzipSync(JSON.stringify(file)));
  const key = backupKey(now);
  await blobs.put(key, body, "application/gzip");
  const all = (await blobs.list(BACKUP_PREFIX)).filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(k));
  const deleted = all.slice(0, Math.max(0, all.length - keep));
  for (const old of deleted) await blobs.delete(old);
  return {
    key,
    documents: Object.values(file.tables).reduce((n, t) => n + t.length, 0),
    bytes: body.length,
    deleted,
  };
}

export function parseBackup(bytes: Uint8Array): BackupFile {
  const file = JSON.parse(gunzipSync(bytes).toString("utf8")) as BackupFile;
  if (file.version !== 1 || typeof file.tables !== "object") throw new Error("not an e-hub backup");
  return file;
}

/** Puts every document of a backup back (upsert; nothing is deleted). Returns how many were written. */
export async function restoreBackup(docs: DocClient, file: BackupFile): Promise<number> {
  let n = 0;
  for (const table of TABLES) {
    for (const doc of file.tables[table] ?? []) {
      await docs.put(table, doc.id, doc.data);
      n += 1;
    }
  }
  return n;
}
