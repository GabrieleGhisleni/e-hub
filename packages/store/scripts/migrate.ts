/**
 * Moves the data of the repo to Turso and the EPUBs/covers to R2 (docs/hosting.md, fase 1).
 *
 *   pnpm --filter @ehub/store migrate --owner-email you@example.com            # dry run: lists what would be uploaded
 *   pnpm --filter @ehub/store migrate --owner-email you@example.com --apply    # really uploads (needs TURSO_* and R2_*)
 *
 * Everything on disk today belongs to the owner. If they have not logged in yet their rows get the placeholder id
 * `email:<address>`, which becomes their Google `sub` at the first login (packages/store/src/users.ts).
 *
 * Idempotent: rows are upserted by id, objects overwritten. Nothing is ever deleted.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MemoryBlobStore,
  MemoryDocClient,
  ensureOwner,
  loadEnvLocal,
  missingHostedEnv,
  planMigration,
  r2FromEnv,
  runMigration,
  tursoFromEnv,
} from "../src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvLocal(repoRoot);
const apply = process.argv.includes("--apply");
const ownerFlag = process.argv.indexOf("--owner-email");
const ownerEmail = ownerFlag >= 0 ? process.argv[ownerFlag + 1]?.trim().toLowerCase() : undefined;
if (!ownerEmail || !/^[^@\s]+@[^@\s]+$/.test(ownerEmail)) {
  console.error("Serve --owner-email <indirizzo>: l'utente a cui assegnare tutti i dati attuali.");
  process.exit(1);
}

const roots = {
  library: path.join(repoRoot, "packages/library/data"),
  explore: path.join(repoRoot, "packages/explore/data"),
  notes: path.join(repoRoot, "packages/notes/data"),
  podcasts: path.join(repoRoot, "packages/podcasts/data"),
};
const cacheDir = process.env.ELIB_CACHE_DIR || path.join(os.homedir(), ".cache", "e-library");

const plan = await planMigration(roots, cacheDir);
console.log(`${plan.items.length} file da migrare, ${plan.skipped.length} restano su disco.`);

let docs = new MemoryDocClient() as ReturnType<typeof tursoFromEnv> & object;
let blobs = new MemoryBlobStore() as ReturnType<typeof r2FromEnv> & object;
if (apply) {
  const missing = missingHostedEnv();
  if (missing.length > 0) {
    console.error(`Mancano queste variabili in .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }
  docs = tursoFromEnv()!;
  blobs = r2FromEnv()!;
} else {
  console.log("Prova a secco (aggiungi --apply per caricare davvero).");
}

const owner = await ensureOwner(docs, ownerEmail);
console.log(`Proprietario: ${owner.email} (${owner.id.startsWith("email:") ? "non ha ancora fatto login: collegato al primo accesso" : "già registrato"}).`);
const result = await runMigration(plan, docs, blobs, owner.id, (item) => {
  if (!apply) console.log(`  ${item.root}: ${item.key}`);
});
console.log(`Documenti: ${result.documents}, file binari: ${result.blobs}, errori: ${result.failed.length}.`);
for (const f of result.failed) console.error(`  ERRORE ${f.key}: ${f.message}`);
if (result.failed.length > 0) process.exit(1);
