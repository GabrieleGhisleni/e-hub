/**
 * The hosted API (docs/hosting.md): one Hono server. With TURSO_DATABASE_URL set it mounts the data dirs on Turso/R2;
 * without, it works on plain files (local use). Secrets come from the environment (systemd EnvironmentFile or
 * .env.local), never from the repo.
 */
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createServiceContext, createServices } from "@ehub/library/services";
import { createApp as createLibraryApp } from "@ehub/library/server";
import { createExploreApp, generateExplorationSynthesis } from "@ehub/explore/server";
import { createNotesApp } from "@ehub/notes/server";
import { createApp as createPodcastsApp } from "@ehub/podcasts/server";
import { exploreDataDir } from "@ehub/explore/node";
import { notesDataDir } from "@ehub/notes/node";
import { dataDir as podcastsDataDir } from "@ehub/podcasts/paths";
import { runAsUser } from "@ehub/store";
import { createApi, passThrough } from "./app.ts";
import { parseAllowedEmails, sessionVerifier } from "./auth.ts";
import { boot } from "./boot.ts";
import { createChat } from "./chat.ts";
import { createGoogleLogin } from "./google.ts";
import { createStoreRoutes } from "./store-routes.ts";

const { env, config, hosted, docs, blobs } = await boot();

let auth;
let google: Hono | undefined;
if (env.SESSION_SECRET && docs) {
  const verify = sessionVerifier(env.SESSION_SECRET);
  // ALLOWED_EMAILS is mandatory: an empty list would let nobody in, so refuse to start (docs/hosting.md).
  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS.join(","));
  if (allowedEmails.size === 0) throw new Error("ALLOWED_EMAILS è obbligatoria: elenca le email che possono entrare.");
  auth = { verify, allowedEmails };
  if (env.GOOGLE_CLIENT_ID) {
    google = createGoogleLogin({
      clientId: env.GOOGLE_CLIENT_ID,
      sessionSecret: env.SESSION_SECRET,
      allowedEmails,
      verify,
      docs,
      blobs,
      koboFor: (email) => env.KOBO_OWNER_EMAIL !== "" && email === env.KOBO_OWNER_EMAIL,
    });
  } else {
    console.warn("Login Google non configurato (GOOGLE_CLIENT_ID): nessuno può entrare.");
  }
} else if (env.API_LOCAL_DEV === "1" && !hosted) {
  // Plain local files have no owners: one fixed identity, no per-user scoping.
  auth = {
    verify: async () => ({ userId: "dev", email: "dev@local" }),
    allowedEmails: new Set<string>(),
    scopeToUser: false,
  };
} else {
  throw new Error("Imposta TURSO_DATABASE_URL e SESSION_SECRET (o API_LOCAL_DEV=1 con file locali, senza database).");
}

const services = createServices(createServiceContext(config));
// Upload staging dirs live in each user's cache folder: clean them user by user.
let removed = 0;
for (const user of docs ? await docs.users.list() : [null]) {
  if (user && user.id.startsWith("email:")) continue; // not logged in yet: no folder on the Pi
  removed += await (user ? runAsUser(user.id, () => services.cleanupStaleUploads()) : services.cleanupStaleUploads());
}
if (removed > 0) console.log(`removed ${removed} stale upload staging dir(s)`);

const app = createApi({
  auth,
  corsOrigins: env.CORS_ORIGINS,
  modules: [
    ...(google ? [google] : []),
    createLibraryApp(services, config, { access: passThrough }),
    createExploreApp({ access: passThrough, synthesize: generateExplorationSynthesis }),
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
