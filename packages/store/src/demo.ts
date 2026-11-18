/**
 * The public demo: a few invented or public-domain examples (demo/seed, same layout as the packages' data dirs) owned
 * by the reserved user `demo`. `seedDemo` replaces everything of that user and nothing else.
 */
import path from "node:path";
import { type BlobStore, scopedBlobs } from "./blobs.ts";
import { DATA_TABLES, type DocClient } from "./docs.ts";
import { type DataRoots } from "./hosted.ts";
import { type MigrationResult, planMigration, runMigration } from "./migrate.ts";
import { DEMO_USER_ID } from "./user-context.ts";

export function demoRoots(seedDir: string): DataRoots {
  return {
    library: path.join(seedDir, "library"),
    explore: path.join(seedDir, "explore"),
    notes: path.join(seedDir, "notes"),
    podcasts: path.join(seedDir, "podcasts"),
  };
}

export interface SeedResult extends MigrationResult {
  removed: number;
}

/** Idempotent: deletes the `demo` user's rows and files, then loads the fixtures. Other users are never touched. */
export async function seedDemo(docs: DocClient, blobs: BlobStore, seedDir: string): Promise<SeedResult> {
  const own = docs.forUser(DEMO_USER_ID);
  let removed = 0;
  for (const table of DATA_TABLES) {
    for (const doc of await own.list(table)) {
      await own.delete(table, doc.id);
      removed += 1;
    }
  }
  const files = scopedBlobs(blobs, DEMO_USER_ID);
  for (const key of await files.list("")) {
    await files.delete(key);
    removed += 1;
  }
  await docs.users.upsert({ id: DEMO_USER_ID, email: "demo@demo.invalid", name: "Demo" });
  const plan = await planMigration(demoRoots(seedDir), path.join(seedDir, ".no-cache"));
  return { ...(await runMigration(plan, docs, blobs, DEMO_USER_ID)), removed };
}
