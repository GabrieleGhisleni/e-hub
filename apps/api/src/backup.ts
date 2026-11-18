/**
 * Run by the systemd timer every night (deploy/pi/ehub-backup.timer): dumps the database to R2 and keeps the last 30.
 *
 *   node ehub-backup.mjs                      make a backup
 *   node ehub-backup.mjs --restore <key>      put a backup back (backups/2026-11-18.json.gz); upserts, never deletes
 */
import { loadEnvLocal, missingHostedEnv, parseBackup, r2FromEnv, restoreBackup, runBackup, tursoFromEnv } from "@ehub/store";

loadEnvLocal(process.cwd());
const missing = missingHostedEnv();
if (missing.length > 0) {
  console.error(`Variabili mancanti: ${missing.join(", ")}`);
  process.exit(1);
}
const docs = tursoFromEnv()!;
const blobs = r2FromEnv()!;

const restoreAt = process.argv.indexOf("--restore");
if (restoreAt !== -1) {
  const key = process.argv[restoreAt + 1];
  if (!key) {
    console.error("Uso: --restore <backups/AAAA-MM-GG.json.gz>");
    process.exit(2);
  }
  const bytes = await blobs.get(key);
  if (!bytes) {
    console.error(`Backup non trovato: ${key}`);
    process.exit(1);
  }
  console.log(`ripristinati ${await restoreBackup(docs, parseBackup(bytes))} documenti da ${key}`);
} else {
  const result = await runBackup(docs, blobs);
  console.log(`backup ${result.key}: ${result.documents} documenti, ${result.bytes} byte; rimossi ${result.deleted.length} vecchi`);
}
