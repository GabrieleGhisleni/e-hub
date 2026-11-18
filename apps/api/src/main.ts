/**
 * The hosted API (docs/hosting.md): one Hono server. With TURSO_DATABASE_URL set it mounts the data dirs on Turso/R2;
 * without, it works on plain files (local use). Secrets come from the environment (systemd EnvironmentFile or
 * .env.local), never from the repo.
 */
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@ehub/library/config";
import { createServiceContext, createServices } from "@ehub/library/services";
import { createApp as createLibraryApp } from "@ehub/library/server";
import { createExploreApp } from "@ehub/explore/server";
import { createNotesApp } from "@ehub/notes/server";
import { createApp as createPodcastsApp } from "@ehub/podcasts/server";
import { blobEpubRemote, setEpubRemote } from "@ehub/library/epub-remote";
import { loadEnvLocal, missingHostedEnv, r2FromEnv, tursoFromEnv } from "@ehub/store";
import { mountHosted } from "@ehub/store/hosted";
import { createApi, passThrough } from "./app.ts";
import { parseAllowedEmails, sessionVerifier } from "./auth.ts";
import { createGoogleLogin } from "./google.ts";
import { createChat } from "./chat.ts";
import { dataRoots, readEnv } from "./env.ts";

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
  const blobs = r2FromEnv()!;
  mountHosted(dirs, tursoFromEnv()!, blobs);
  // EPUBs: the cache is the working copy, R2 the durable one.
  setEpubRemote(blobEpubRemote(blobs));
}

let auth;
let google: Hono | undefined;
if (env.SESSION_SECRET && env.ALLOWED_EMAILS.length > 0) {
  const verify = sessionVerifier(env.SESSION_SECRET);
  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS.join(","));
  auth = { verify, allowedEmails };
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_API_URL) {
    google = createGoogleLogin({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      publicUrl: env.PUBLIC_API_URL,
      sessionSecret: env.SESSION_SECRET,
      allowedEmails,
      siteOrigins: env.CORS_ORIGINS,
      verify,
    });
  } else {
    console.warn("Login Google non configurato (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_API_URL): le scritture restano chiuse.");
  }
} else if (env.API_LOCAL_DEV === "1") {
  auth = { verify: async () => ({ email: "dev@local" }), allowedEmails: new Set(["dev@local"]) };
} else {
  throw new Error("Imposta SESSION_SECRET e ALLOWED_EMAILS (o API_LOCAL_DEV=1 in locale).");
}

const services = createServices(createServiceContext(config));
const removed = await services.cleanupStaleUploads();
if (removed > 0) console.log(`removed ${removed} stale upload staging dir(s)`);

const app = createApi({
  auth,
  corsOrigins: env.CORS_ORIGINS,
  modules: [
    ...(google ? [google] : []),
    createLibraryApp(services, config, { access: passThrough }),
    createExploreApp({ access: passThrough }),
    createNotesApp({ access: passThrough }),
    createPodcastsApp({ access: passThrough }),
    createChat(),
  ],
});

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`ehub api on http://${env.HOST}:${info.port} (${hosted ? "Turso + R2" : "file locali"})`);
});
