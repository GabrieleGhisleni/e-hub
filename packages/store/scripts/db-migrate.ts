/**
 * Applies turso/migrations/*.sql to the database named in .env.local (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).
 * Each file is applied once (table `schema_migrations`), in one transaction.
 *
 *   pnpm --filter @ehub/store db:migrate           # prints what it would run
 *   pnpm --filter @ehub/store db:migrate --apply   # runs it
 */
import { createClient } from "@libsql/client/web";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal } from "../src/env.ts";
import { applyMigrations, splitStatements } from "../src/sql.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvLocal(repoRoot);
const dir = path.join(repoRoot, "turso/migrations");
const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const files = await Promise.all(names.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), "utf8") })));
console.log(`${files.flatMap((f) => splitStatements(f.sql)).length} istruzioni in ${files.length} file.`);

if (!process.argv.includes("--apply")) {
  console.log("Prova a secco (aggiungi --apply per eseguire).");
  process.exit(0);
}
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const local = url?.startsWith("file:") || url === ":memory:";
if (!url || (!authToken && !local)) {
  console.error("Mancano TURSO_DATABASE_URL e/o TURSO_AUTH_TOKEN in .env.local");
  process.exit(1);
}
const db = local ? (await import("@libsql/client")).createClient({ url }) : createClient({ url, authToken: authToken! });
const applied = await applyMigrations(db as never, files);
console.log(applied.length > 0 ? `Applicate: ${applied.join(", ")}.` : "Niente da applicare.");
