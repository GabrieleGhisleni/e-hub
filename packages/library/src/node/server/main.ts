/**
 * `pnpm server` — the local Hono server (PLAN §3). Listens on 127.0.0.1 only, never on other interfaces; port from
 * elib.config.json (`ELIB_CONFIG` / `ELIB_DATA_DIR` / `ELIB_CACHE_DIR` override for tests and smoke runs).
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "../config/index.ts";
import { createServiceContext, createServices } from "../services/index.ts";
import { createApp } from "./app.ts";

const HOSTNAME = "127.0.0.1";

const config = loadConfig();
const services = createServices(createServiceContext(config));
const removed = await services.cleanupStaleUploads();
if (removed > 0) console.log(`removed ${removed} stale upload staging dir(s)`);

const app = createApp(services, config);
serve({ fetch: app.fetch, hostname: HOSTNAME, port: config.server.port }, (info) => {
  console.log(`e-library server on http://${HOSTNAME}:${info.port} (data: ${config.dataDir})`);
});
