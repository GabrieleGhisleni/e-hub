/**
 * The hosted API (docs/hosting.md): one Hono server. With TURSO_DATABASE_URL set it mounts the data dirs on Turso/R2;
 * without, it works on plain files (local use). Secrets come from the environment (systemd EnvironmentFile or
 * .env.local), never from the repo.
 */
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createServiceContext, createServices } from "@ehub/library/services";
import { createApp as createLibraryApp } from "@ehub/library/server";
import { createExploreApp } from "@ehub/explore/server";
import { createNotesApp } from "@ehub/notes/server";
import { createApp as createPodcastsApp } from "@ehub/podcasts/server";
import { exploreDataDir } from "@ehub/explore/node";
import { notesDataDir } from "@ehub/notes/node";
import { dataDir as podcastsDataDir } from "@ehub/podcasts/paths";
import { createApi, passThrough } from "./app.ts";
import { parseAllowedEmails, sessionVerifier } from "./auth.ts";
import { boot } from "./boot.ts";
import { createChat } from "./chat.ts";
import { createGoogleLogin } from "./google.ts";
import { createStoreRoutes } from "./store-routes.ts";

const { env, config, hosted } = boot();

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
    createStoreRoutes({
      library: config.dataDir,
      explore: process.env.EHUB_EXPLORE_DATA_DIR ?? exploreDataDir(),
      notes: process.env.EHUB_NOTES_DATA_DIR ?? notesDataDir(),
      podcasts: process.env.E_PODCASTS_DATA_DIR ?? podcastsDataDir(),
    }),
    createChat(),
  ],
});

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`ehub api on http://${env.HOST}:${info.port} (${hosted ? "Turso + R2" : "file locali"})`);
});
