/**
 * `GET /api/library/health/services`: one probe per service the app depends on (backend, database, AI router,
 * Z-Library). Each probe has its own timeout and never throws: a failing service shows as `error` with the reason.
 */
import path from "node:path";
import type { Hono } from "hono";
import { DEFAULT_AI_BASE_URL } from "@ehub/chat/node";
import { currentUserId, listDir, readUserSettings } from "@ehub/store";
import {
  type ServiceCheck,
  type ServicesHealthResponse,
  healthPaths,
} from "../../shared/settings.ts";
import type { Services } from "../services/index.ts";
import type { ZlibraryClient } from "../zlibrary/index.ts";

const PROBE_TIMEOUT_MS = 6000;

async function timed(
  base: Pick<ServiceCheck, "id" | "label">,
  run: () => Promise<Pick<ServiceCheck, "status" | "detail"> & { skipTiming?: boolean }>,
): Promise<ServiceCheck> {
  const started = Date.now();
  try {
    const result = await run();
    return { ...base, status: result.status, detail: result.detail, ms: result.skipTiming ? null : Date.now() - started };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...base, status: "error", detail: reason, ms: Date.now() - started };
  }
}

export function registerHealthRoutes(
  app: Hono,
  services: Services,
  pickZlibrary: () => Promise<ZlibraryClient>,
): void {
  app.get(healthPaths.services, async (c) => {
    const hosted = Boolean(process.env.TURSO_DATABASE_URL);
    const checks = await Promise.all([
      timed({ id: "backend", label: "Backend" }, async () => ({
        status: "ok",
        detail: `${hosted ? "Hosted" : "Locale"} · Node ${process.version} · in esecuzione da ${Math.round(process.uptime() / 60)} min`,
        skipTiming: true,
      })),
      timed({ id: "db", label: "Database" }, async () => {
        // The same read the app does for the library: goes to Turso when hosted, to the data folder otherwise.
        const books = await listDir(path.join(services.ctx.dataDir, "books"));
        const count = books.filter((entry) => entry.isDirectory).length;
        return { status: "ok", detail: `${hosted ? "Turso + R2" : "File locali"} · ${count} ${count === 1 ? "libro" : "libri"}` };
      }),
      timed({ id: "ai", label: "AI (router)" }, async () => {
        const own = await readUserSettings();
        const env = currentUserId() === null ? process.env : {};
        const baseUrl = (own.ai.baseUrl ?? env.EHUB_AI_BASE_URL?.trim() ?? DEFAULT_AI_BASE_URL).replace(/\/+$/, "");
        const key = own.ai.apiKey ?? env.EHUB_AI_API_KEY?.trim();
        if (!key) return { status: "off", detail: "Nessuna chiave: aggiungila nelle chiavi personali.", skipTiming: true };
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) return { status: "error", detail: `${new URL(baseUrl).host}: HTTP ${response.status}` };
        return { status: "ok", detail: new URL(baseUrl).host };
      }),
      timed({ id: "zlibrary", label: "Z-Library" }, async () => {
        const client = await pickZlibrary();
        await client.restore();
        if (!client.configured) return { status: "off", detail: "Nessun account collegato.", skipTiming: true };
        const quota = await client.quota();
        const used = quota && quota.limit > 0 ? ` · download oggi ${quota.today}/${quota.limit}` : "";
        return { status: "ok", detail: `${client.accountEmail ?? "account collegato"} · ${new URL(client.baseUrl).host}${used}` };
      }),
    ]);
    const body: ServicesHealthResponse = { checkedAt: new Date().toISOString(), checks };
    return c.json(body, 200, { "Cache-Control": "no-store" });
  });
}
