/**
 * `pnpm server` — the local Hono server (PLAN §3). Listens on 127.0.0.1 only, never on other interfaces; port from
 * elib.config.json (`ELIB_CONFIG` / `ELIB_DATA_DIR` / `ELIB_CACHE_DIR` override for tests and smoke runs).
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "../config/index.ts";
import { loadLocalEnv } from "../summary/llm.ts";
import { createServiceContext, createServices } from "../services/index.ts";
import { ZlibraryClient, zlibraryEnvFrom } from "../zlibrary/index.ts";
import { createApp } from "./app.ts";

// Secrets (Z-Library credentials) live in the git-ignored packages/library/.env; a missing file is fine.
// Runs before any environment is read below. Variables already set in the shell win.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env: only the variables of the shell apply
}

const HOSTNAME = "127.0.0.1";

// EHUB_AI_* (summaries, chat) from the monorepo's .env.local, before any service reads the environment.
loadLocalEnv();
const config = loadConfig();
const services = createServices(createServiceContext(config));
const removed = await services.cleanupStaleUploads();
if (removed > 0) console.log(`removed ${removed} stale upload staging dir(s)`);

const zlibrary = new ZlibraryClient(zlibraryEnvFrom(), services.ctx.cacheDir);
console.log(
  zlibrary.configured
    ? `Z-Library: configurata (${zlibrary.baseUrl})`
    : "Z-Library: non configurata (imposta ZLIBRARY_* in packages/library/.env)",
);
// No client passed: the app builds its own, which also follows the Z-Library address set in Impostazioni.
const app = createApp(services, config);
serve({ fetch: app.fetch, hostname: HOSTNAME, port: config.server.port }, (info) => {
  console.log(`e-library server on http://${HOSTNAME}:${info.port} (data: ${config.dataDir})`);
});
