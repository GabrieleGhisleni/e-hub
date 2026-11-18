/**
 * Loads the public demo (demo/seed) as the reserved user `demo`. Idempotent: only the rows and files of `demo` are
 * replaced. Needs TURSO_* and R2_* in .env.local (nothing else is touched).
 *
 *   pnpm --filter @ehub/store seed-demo
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal, missingHostedEnv, r2FromEnv, seedDemo, tursoFromEnv } from "../src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvLocal(repoRoot);
const missing = missingHostedEnv();
if (missing.length > 0) {
  console.error(`Mancano queste variabili in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
const result = await seedDemo(tursoFromEnv()!, r2FromEnv()!, path.join(repoRoot, "demo/seed"));
console.log(`Demo caricata: ${result.documents} documenti, ${result.blobs} file (rimossi prima: ${result.removed}).`);
for (const f of result.failed) console.error(`  ERRORE ${f.key}: ${f.message}`);
if (result.failed.length > 0) process.exit(1);
