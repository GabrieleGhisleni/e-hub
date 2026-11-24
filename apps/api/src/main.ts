/**
 * The API (docs/hosting.md): one Hono server on the data in Turso/R2, on the Pi and, with `pnpm dev`, on the laptop
 * against the same database. Secrets come from the environment (systemd EnvironmentFile or .env.local), never from the
 * repo.
 */
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createServiceContext, createServices } from "@ehub/library/services";
import { createApp as createLibraryApp } from "@ehub/library/server";
import { createExploreApp, generateExplorationSynthesis } from "@ehub/explore/server";
import { createNotesApp } from "@ehub/notes/server";
import { createApp as createPodcastsApp } from "@ehub/podcasts/server";
import { runAsUser } from "@ehub/store";
import { createApi, passThrough } from "./app.ts";
import { parseAllowedEmails, sessionVerifier } from "./auth.ts";
import { boot } from "./boot.ts";
import { createChat } from "./chat.ts";
import { createDevLogin } from "./dev-login.ts";
import { createGoogleLogin } from "./google.ts";
import { createStoreRoutes } from "./store-routes.ts";

const { env, config, dirs, docs, blobs } = await boot();

if (!env.SESSION_SECRET) throw new Error("Imposta SESSION_SECRET (almeno 32 caratteri casuali).");
const verify = sessionVerifier(env.SESSION_SECRET);
// ALLOWED_EMAILS is mandatory: an empty list would let nobody in, so refuse to start (docs/hosting.md).
const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS.join(","));
if (allowedEmails.size === 0) throw new Error("ALLOWED_EMAILS è obbligatoria: elenca le email che possono entrare.");
const auth = { verify, allowedEmails };

let google: Hono | undefined;
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
} else if (env.API_DEV_OWNER_EMAIL === "") {
  console.warn("Login Google non configurato (GOOGLE_CLIENT_ID): nessuno può entrare.");
}
// `pnpm dev`: the owner gets a session without Google (boot() already refused a non-loopback HOST).
const devLogin =
  env.API_DEV_OWNER_EMAIL === ""
    ? undefined
    : createDevLogin({ docs, sessionSecret: env.SESSION_SECRET, ownerEmail: env.API_DEV_OWNER_EMAIL });

const services = createServices(createServiceContext(config));
// Upload staging dirs live in each user's cache folder: clean them user by user.
let removed = 0;
for (const user of await docs.users.list()) {
  if (user.id.startsWith("email:")) continue; // not logged in yet: no folder on the Pi
  removed += await runAsUser(user.id, () => services.cleanupStaleUploads());
}
if (removed > 0) console.log(`removed ${removed} stale upload staging dir(s)`);

const app = createApi({
  auth,
  corsOrigins: env.CORS_ORIGINS,
  modules: [
    ...(google ? [google] : []),
    ...(devLogin ? [devLogin] : []),
    createLibraryApp(services, config, { access: passThrough }),
    createExploreApp({ access: passThrough, synthesize: generateExplorationSynthesis }),
    createNotesApp({ access: passThrough }),
    createPodcastsApp({ access: passThrough }),
    createStoreRoutes(dirs),
    createChat(),
  ],
});

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`ehub api on http://${env.HOST}:${info.port} (Turso + R2${devLogin ? `, accesso di sviluppo per ${env.API_DEV_OWNER_EMAIL}` : ""})`);
});
