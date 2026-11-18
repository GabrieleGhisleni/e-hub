/**
 * What the API and the Kobo timer share: environment, data dir mounts (Turso/R2 when TURSO_DATABASE_URL is set),
 * the EPUB remote and the library config.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blobEpubRemote, setEpubRemote } from "@ehub/library/epub-remote";
import { loadConfig } from "@ehub/library/config";
import { setKoboAccessPolicy } from "@ehub/library/kobo";
import {
  type BlobStore,
  type DocClient,
  currentUserEmail,
  loadEnvLocal,
  localDbFromEnv,
  missingHostedEnv,
  r2FromEnv,
  tursoFromEnv,
} from "@ehub/store";
import { mountHosted } from "@ehub/store/hosted";
import { dataRoots, readEnv } from "./env.ts";

export async function boot() {
  loadEnvLocal(process.cwd());
  loadEnvLocal(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  const env = readEnv();

  const loopback = /^(127\.0\.0\.1|localhost|::1)$/.test(env.HOST);
  if (env.API_LOCAL_DEV === "1" && !loopback) {
    throw new Error("API_LOCAL_DEV=1 è ammesso solo con HOST su loopback.");
  }

  // Data dirs: the packages read these variables on every call.
  if (env.EHUB_DATA_ROOT) {
    const roots = dataRoots(path.resolve(env.EHUB_DATA_ROOT));
    process.env.ELIB_DATA_DIR ??= roots.library;
    process.env.EHUB_EXPLORE_DATA_DIR ??= roots.explore;
    process.env.EHUB_NOTES_DATA_DIR ??= roots.notes;
    process.env.E_PODCASTS_DATA_DIR ??= roots.podcasts;
  }

  const config = loadConfig();
  const hosted = process.env.TURSO_DATABASE_URL !== undefined;
  let docs: DocClient | null = null;
  let blobs: BlobStore | null = null;
  if (hosted) {
    const missing = missingHostedEnv();
    if (missing.length > 0) throw new Error(`Variabili mancanti: ${missing.join(", ")}`);
    const dirs = {
      library: config.dataDir,
      explore: process.env.EHUB_EXPLORE_DATA_DIR!,
      notes: process.env.EHUB_NOTES_DATA_DIR!,
      podcasts: process.env.E_PODCASTS_DATA_DIR!,
    };
    for (const [name, dir] of Object.entries(dirs)) {
      if (!dir) throw new Error(`Cartella dati «${name}» non impostata (EHUB_DATA_ROOT).`);
    }
    blobs = r2FromEnv()!;
    docs = (await localDbFromEnv()) ?? tursoFromEnv()!;
    mountHosted(dirs, docs, blobs);
    // The Kobo is one device on the owner's LAN: only the owner's requests reach it.
    setKoboAccessPolicy(() => env.KOBO_OWNER_EMAIL !== "" && currentUserEmail() === env.KOBO_OWNER_EMAIL);
    // EPUBs: the cache is the working copy, R2 the durable one.
    setEpubRemote(blobEpubRemote(blobs));
  }
  return { env, config, hosted, docs, blobs };
}
