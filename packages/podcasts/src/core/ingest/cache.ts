/**
 * `data/cache/` (gitignored, DESIGN.md §2.4): rebuildable ingest state — the
 * Lex `youtubeId` → transcript page map, the Huberman wiki clone and its index.
 * Follows `E_PODCASTS_DATA_DIR`, so tests and dry runs get their own cache.
 */
import path from "node:path";
import type { z } from "zod";
import { readJsonIfExists, writeJsonAtomic } from "../json-file";
import { dataDir } from "../paths";

export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

export function cachePath(name: string): string {
  return path.join(cacheDir(), name);
}

/** Reads a cache file; `undefined` if missing, unreadable or not matching the schema (it gets rebuilt). */
export async function readCache<S extends z.ZodType>(
  name: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  let raw: unknown;
  try {
    raw = await readJsonIfExists(cachePath(name));
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function writeCache(name: string, value: unknown): Promise<void> {
  await writeJsonAtomic(cachePath(name), value);
}
