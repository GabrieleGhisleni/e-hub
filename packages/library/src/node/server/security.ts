/**
 * Request checks of the local server (PLAN §3, §14): any site open in the browser can send requests to 127.0.0.1,
 * and this server can move Drive files to the trash. Only the local UI may talk to it.
 *
 * - `Host` must be one of ours (DNS rebinding: a foreign name resolving to 127.0.0.1 carries its own Host). Allowed:
 *   `127.0.0.1:<port>`, `localhost:<port>` (direct calls, curl) and the host of every allowed UI origin, because the
 *   Vite dev proxy forwards `/api/library` with `changeOrigin: false`, i.e. with the browser's `Host: 127.0.0.1:5173`.
 * - `Origin`, when present, must be in `server.allowedOrigins`; non-GET/HEAD requests must carry one (browsers always
 *   send it on such requests, so a missing Origin means a non-browser client: pass it explicitly with curl).
 * - `Sec-Fetch-Site` must be `same-origin` or `none` when present: the UI calls through the Vite proxy (same origin), so
 *   `cross-site` and also `same-site` (another port on localhost) are rejected. Image tags of other local pages
 *   therefore cannot trigger the GET endpoints that do work (cover candidates).
 * - No CORS headers are ever sent.
 */
import type { MiddlewareHandler } from "hono";
import type { ApiErrorCode } from "../../shared/api.ts";
import type { ElibConfig } from "../../shared/config.ts";

export interface SecurityConfig {
  port: number;
  allowedOrigins: readonly string[];
}

export function securityConfig(config: Pick<ElibConfig, "server">): SecurityConfig {
  return { port: config.server.port, allowedOrigins: config.server.allowedOrigins };
}

/** Host header values accepted (lowercase `host:port`). */
export function allowedHosts(config: SecurityConfig): Set<string> {
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  for (const origin of config.allowedOrigins) {
    try {
      hosts.add(new URL(origin).host.toLowerCase());
    } catch {
      // the config schema only lets valid origins through
    }
  }
  return hosts;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

export function securityMiddleware(config: SecurityConfig): MiddlewareHandler {
  const hosts = allowedHosts(config);
  const origins = new Set(config.allowedOrigins);
  return async (c, next) => {
    const deny = (code: ApiErrorCode, message: string) =>
      c.json({ error: { code, message } }, 403, { "Cache-Control": "no-store" });

    const host = c.req.header("host")?.trim().toLowerCase();
    if (!host || !hosts.has(host)) {
      return deny("forbidden-host", `Host non consentito: ${host ?? "(mancante)"}.`);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !origins.has(origin)) {
      return deny("forbidden-origin", `Origine non consentita: ${origin}.`);
    }
    if (!SAFE_METHODS.has(c.req.method) && origin === undefined) {
      return deny(
        "origin-required",
        "Richiesta di modifica senza header Origin: sono ammesse solo richieste dalla UI locale.",
      );
    }
    const fetchSite = c.req.header("sec-fetch-site")?.trim().toLowerCase();
    if (fetchSite !== undefined && !ALLOWED_FETCH_SITES.has(fetchSite)) {
      return deny(
        "forbidden-fetch-site",
        `Richiesta da un altro sito (Sec-Fetch-Site: ${fetchSite}).`,
      );
    }
    await next();
  };
}
