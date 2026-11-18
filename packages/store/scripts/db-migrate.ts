/**
 * Applies turso/migrations/*.sql to the database named in .env.local (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).
 *
 *   pnpm --filter @ehub/store db:migrate           # prints what it would run
 *   pnpm --filter @ehub/store db:migrate --apply   # runs it (every statement is idempotent)
 */
import { createClient } from "@libsql/client/web";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal } from "../src/env.ts";
import { splitStatements } from "../src/sql.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvLocal(repoRoot);
const dir = path.join(repoRoot, "turso/migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const statements = (await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8")))).flatMap(splitStatements);
console.log(`${statements.length} istruzioni in ${files.length} file.`);

if (!process.argv.includes("--apply")) {
  console.log("Prova a secco (aggiungi --apply per eseguire).");
  process.exit(0);
}
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Mancano TURSO_DATABASE_URL e/o TURSO_AUTH_TOKEN in .env.local");
  process.exit(1);
}
const db = createClient({ url, authToken });
for (const sql of statements) await db.execute(sql);
console.log("Fatto.");
