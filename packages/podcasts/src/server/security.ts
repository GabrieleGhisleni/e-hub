/**
 * Security middleware for the local write server (DESIGN.md §9). The server
 * writes files that end up in a public repo, so every `/api/podcasts` request must come
 * from the app itself:
 *
 * - `Host` must be loopback (`localhost`, `127.0.0.1`, `[::1]`): DNS rebinding
 *   protection, independent of Vite's own `allowedHosts` check.
 * - Writes (POST/PUT/PATCH/DELETE) must be `application/json` (this forces a
 *   CORS preflight for cross-origin pages) and carry an `Origin` equal to the
 *   dev server's own origin (`http://<Host>`), so a page on another site, or on
 *   another localhost port, cannot write.
 */
import type { MiddlewareHandler } from "hono";

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isLoopbackHost(host: string | undefined): host is string {
  return host !== undefined && LOOPBACK_HOST.test(host);
}

function forbidden(status: 403 | 415, code: string, error: string) {
  return Response.json({ error, code }, { status });
}

export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host");
  if (!isLoopbackHost(host)) {
    return forbidden(
      403,
      "forbidden-host",
      "Host non consentito: il server accetta solo localhost.",
    );
  }
  if (WRITE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type") ?? "";
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return forbidden(
        415,
        "unsupported-media-type",
        "Le scritture richiedono Content-Type: application/json.",
      );
    }
    const origin = c.req.header("origin");
    if (origin === undefined || origin.toLowerCase() !== `http://${host}`.toLowerCase()) {
      return forbidden(403, "forbidden-origin", "Origin non consentito per le scritture.");
    }
  }
  await next();
};
