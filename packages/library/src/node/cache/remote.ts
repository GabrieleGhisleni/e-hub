/**
 * The original EPUBs in the hosted setup (docs/hosting.md): the local cache stays the working copy, a private R2 bucket
 * holds the only durable one (`books/<id>.epub`). With no remote set (tests, local use) everything here is a no-op.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "@ehub/store";
import { cachedEpubPath, ensureDir, isNonEmptyFile } from "./index.ts";

export interface EpubRemote {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
}

export function blobEpubRemote(blobs: BlobStore): EpubRemote {
  const key = (id: string) => `books/${id}.epub`;
  return {
    put: (id, bytes) => blobs.put(key(id), bytes, "application/epub+zip"),
    get: (id) => blobs.get(key(id)),
  };
}

let remote: EpubRemote | null = null;

export function setEpubRemote(next: EpubRemote | null): void {
  remote = next;
}

/** Uploads the cached EPUB of a book (after it was written to the cache). */
export async function pushEpub(cacheDir: string, id: string): Promise<void> {
  if (!remote) return;
  await remote.put(id, new Uint8Array(await readFile(cachedEpubPath(cacheDir, id))));
}

/** True when the EPUB is in the cache, downloading it from the remote first if it is not. Never throws for a missing one. */
export async function ensureCachedEpub(cacheDir: string, id: string): Promise<boolean> {
  const file = cachedEpubPath(cacheDir, id);
  if (await isNonEmptyFile(file)) return true;
  if (!remote) return false;
  const bytes = await remote.get(id);
  if (!bytes || bytes.length === 0) return false;
  await ensureDir(path.dirname(file));
  await writeFile(file, bytes);
  return true;
}
