/**
 * One-off migration: reads the data directories (and the EPUB cache) as they are on disk today and pushes them to the
 * hosted stores through the same routes the server uses. Pure planning here; `scripts/migrate.ts` is the command line.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type Backend } from "./backend.ts";
import { type BlobStore, scopedBlobs } from "./blobs.ts";
import { runAsUser } from "./user-context.ts";
import { type DocClient } from "./docs.ts";
import {
  HostedBackend,
  type DataRoots,
  type Layout,
  exploreLayout,
  libraryLayout,
  notesLayout,
  podcastsLayout,
} from "./hosted.ts";

export interface MigrationItem {
  /** Which data dir the file comes from. */
  root: keyof DataRoots | "epub";
  file: string;
  key: string;
}

const LAYOUTS: Record<keyof DataRoots, Layout> = {
  library: libraryLayout,
  explore: exploreLayout,
  notes: notesLayout,
  podcasts: podcastsLayout,
};

async function walk(dir: string, base = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, base), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

export interface MigrationPlan {
  items: MigrationItem[];
  /** Files in the data dirs that no route claims (they stay on disk: audio, caches…). */
  skipped: string[];
}

/** Which files would be migrated. Reads nothing but directory listings. */
export async function planMigration(roots: DataRoots, cacheDir: string): Promise<MigrationPlan> {
  const items: MigrationItem[] = [];
  const skipped: string[] = [];
  for (const name of Object.keys(LAYOUTS) as (keyof DataRoots)[]) {
    const backend = new HostedBackend(null as never, null as never, LAYOUTS[name]);
    for (const key of await walk(roots[name])) {
      if (backend.handles(key)) items.push({ root: name, file: path.join(roots[name], key), key });
      else skipped.push(`${name}/${key}`);
    }
  }
  const booksDir = path.join(cacheDir, "books");
  let ids: string[] = [];
  try {
    ids = (await readdir(booksDir)).sort();
  } catch {
    /* no cache: nothing to upload */
  }
  for (const id of ids) {
    const file = path.join(booksDir, id, "book.epub");
    try {
      await readFile(file).then(() => undefined);
      items.push({ root: "epub", file, key: `books/${id}.epub` });
    } catch {
      /* a book without an original EPUB (never uploaded) */
    }
  }
  return { items, skipped };
}

export interface MigrationResult {
  documents: number;
  blobs: number;
  failed: { key: string; message: string }[];
}

/** Pushes the planned files. Failures are collected, not thrown, so one bad file does not hide the others. */
export async function runMigration(
  plan: MigrationPlan,
  docs: DocClient,
  blobs: BlobStore,
  /** The owner of everything that is migrated (a real `sub` or the placeholder of `ensureOwner`). */
  userId: string,
  onProgress: (item: MigrationItem) => void = () => {},
): Promise<MigrationResult> {
  const backends = new Map<string, Backend>();
  for (const name of Object.keys(LAYOUTS) as (keyof DataRoots)[]) {
    backends.set(name, new HostedBackend(docs, blobs, LAYOUTS[name]));
  }
  const result: MigrationResult = { documents: 0, blobs: 0, failed: [] };
  const owned = scopedBlobs(blobs, userId);
  for (const item of plan.items) {
    onProgress(item);
    try {
      const bytes = new Uint8Array(await readFile(item.file));
      if (item.root === "epub") {
        await owned.put(item.key, bytes, "application/epub+zip");
        result.blobs += 1;
      } else {
        await runAsUser(userId, () => backends.get(item.root as keyof DataRoots)!.write(item.key, bytes));
        if (item.key.endsWith(".webp")) result.blobs += 1;
        else result.documents += 1;
      }
    } catch (error) {
      result.failed.push({ key: `${item.root}/${item.key}`, message: (error as Error).message });
    }
  }
  return result;
}
