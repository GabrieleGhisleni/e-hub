/**
 * Moves the data of the repo to Supabase and the EPUBs/covers to R2 (docs/hosting.md, fase 1).
 *
 *   pnpm --filter @ehub/store migrate            # dry run: lists what would be uploaded, touches nothing
 *   pnpm --filter @ehub/store migrate --apply    # really uploads (needs SUPABASE_* and R2_* in .env.local)
 *
 * Idempotent: rows are upserted by id, objects overwritten. Nothing is ever deleted.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MemoryBlobStore,
  MemoryDocClient,
  loadEnvLocal,
  missingHostedEnv,
  planMigration,
  r2FromEnv,
  runMigration,
  supabaseFromEnv,
} from "../src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvLocal(repoRoot);
const apply = process.argv.includes("--apply");

const roots = {
  library: path.join(repoRoot, "packages/library/data"),
  explore: path.join(repoRoot, "packages/explore/data"),
  notes: path.join(repoRoot, "packages/notes/data"),
  podcasts: path.join(repoRoot, "packages/podcasts/data"),
};
const cacheDir = process.env.ELIB_CACHE_DIR || path.join(os.homedir(), ".cache", "e-library");

const plan = await planMigration(roots, cacheDir);
console.log(`${plan.items.length} file da migrare, ${plan.skipped.length} restano su disco.`);

let docs = new MemoryDocClient() as ReturnType<typeof supabaseFromEnv> & object;
let blobs = new MemoryBlobStore() as ReturnType<typeof r2FromEnv> & object;
if (apply) {
  const missing = missingHostedEnv();
  if (missing.length > 0) {
    console.error(`Mancano queste variabili in .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }
  docs = supabaseFromEnv()!;
  blobs = r2FromEnv()!;
} else {
  console.log("Prova a secco (aggiungi --apply per caricare davvero).");
}

const result = await runMigration(plan, docs, blobs, (item) => {
  if (!apply) console.log(`  ${item.root}: ${item.key}`);
});
console.log(`Documenti: ${result.documents}, file binari: ${result.blobs}, errori: ${result.failed.length}.`);
for (const f of result.failed) console.error(`  ERRORE ${f.key}: ${f.message}`);
if (result.failed.length > 0) process.exit(1);
