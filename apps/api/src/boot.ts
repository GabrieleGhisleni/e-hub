/**
 * What the API and the Kobo timer share: environment, data dir mounts on Turso/R2, the EPUB remote and the library
 * config. The database is always the real one (Turso): there is no file mode. `pnpm dev` runs this same code on the
 * laptop with the secrets of `.env.local`.
 */
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { blobEpubRemote, setEpubRemote } from "@ehub/library/epub-remote";
import { loadConfig } from "@ehub/library/config";
import { setKoboAccessPolicy } from "@ehub/library/kobo";
import { exploreDataDir } from "@ehub/explore/node";
import { notesDataDir } from "@ehub/notes/node";
import { dataDir as podcastsDataDir } from "@ehub/podcasts/paths";
import { currentUserEmail, loadEnvLocal, missingHostedEnv, r2FromEnv, tursoFromEnv } from "@ehub/store";
import { mountHosted } from "@ehub/store/hosted";
import { dataRoots, readEnv } from "./env.ts";

export async function boot() {
  loadEnvLocal(process.cwd());
  loadEnvLocal(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  const env = readEnv();

  const loopback = /^(127\.0\.0\.1|localhost|::1)$/.test(env.HOST);
  if (env.API_DEV_OWNER_EMAIL !== "") {
    if (!loopback) throw new Error("API_DEV_OWNER_EMAIL è ammessa solo con HOST su loopback.");
    // Development: the login of the owner is the local one, so a throwaway secret and the owner's own email will do.
    env.SESSION_SECRET ??= randomBytes(32).toString("hex");
    if (env.ALLOWED_EMAILS.length === 0) env.ALLOWED_EMAILS.push(env.API_DEV_OWNER_EMAIL);
  }

  // Data dirs: virtual mount roots (the data lives in Turso/R2); the packages read these variables on every call.
  if (env.EHUB_DATA_ROOT) {
    const roots = dataRoots(path.resolve(env.EHUB_DATA_ROOT));
    process.env.ELIB_DATA_DIR ??= roots.library;
    process.env.EHUB_EXPLORE_DATA_DIR ??= roots.explore;
    process.env.EHUB_NOTES_DATA_DIR ??= roots.notes;
    process.env.E_PODCASTS_DATA_DIR ??= roots.podcasts;
  }

  const config = loadConfig();
  const missing = missingHostedEnv();
  if (missing.length > 0) throw new Error(`Variabili mancanti (in .env.local o nell'ambiente): ${missing.join(", ")}`);
  const blobs = r2FromEnv()!;
  const docs = tursoFromEnv()!;
  const dirs = {
    library: config.dataDir,
    explore: process.env.EHUB_EXPLORE_DATA_DIR ?? exploreDataDir(),
    notes: process.env.EHUB_NOTES_DATA_DIR ?? notesDataDir(),
    podcasts: process.env.E_PODCASTS_DATA_DIR ?? podcastsDataDir(),
  };
  mountHosted(dirs, docs, blobs);
  // The Kobo is one device on the owner's LAN: only the owner's requests reach it.
  setKoboAccessPolicy(() => env.KOBO_OWNER_EMAIL !== "" && currentUserEmail() === env.KOBO_OWNER_EMAIL);
  // EPUBs: the cache is the working copy, R2 the durable one.
  setEpubRemote(blobEpubRemote(blobs));
  return { env, config, dirs, docs, blobs };
}
