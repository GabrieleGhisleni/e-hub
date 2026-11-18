/**
 * Read side of the hosted site: the same documents the static site used to publish (`index.json`, one detail per book,
 * the hashed covers), built on demand from the data store. Public (GET); cached for a few seconds and dropped on every
 * write, so an edit shows up at once.
 */
import { readBytesIfExists } from "@ehub/store";
import type { Hono } from "hono";
import { type SiteData, buildSiteData } from "../site-data/build.ts";

const TTL_MS = 5000;
const SITE = "/api/library/site";

export interface SiteRoutesOptions {
  dataDir: string;
  /** Public URL of the API (cover URLs are absolute, the site lives on another origin). Default: the request's origin. */
  publicUrl?: string;
  now?: () => number;
}

export interface SiteCache {
  invalidate(): void;
}

export function registerSiteRoutes(app: Hono, options: SiteRoutesOptions): SiteCache {
  const now = options.now ?? Date.now;
  let cached: { at: number; origin: string; data: SiteData } | undefined;
  let generation = 0;

  const load = async (origin: string): Promise<SiteData> => {
    if (cached && cached.origin === origin && now() - cached.at < TTL_MS) return cached.data;
    const started = generation;
    const data = await buildSiteData(options.dataDir, {
      basePath: "/",
      coverBase: `${origin}${SITE}/covers/`,
    });
    if (started === generation) cached = { at: now(), origin, data };
    return data;
  };
  const originOf = (url: string) => (options.publicUrl ?? new URL(url).origin).replace(/\/+$/, "");

  app.get(`${SITE}/index.json`, async (c) => c.json((await load(originOf(c.req.url))).index));
  app.get(`${SITE}/books/:file`, async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".json")) return c.json({ error: "Non trovato.", code: "not-found" }, 404);
    const detail = (await load(originOf(c.req.url))).details.get(file.slice(0, -".json".length));
    return detail ? c.json(detail) : c.json({ error: "Libro non trovato.", code: "not-found" }, 404);
  });
  app.get(`${SITE}/covers/:file`, async (c) => {
    const data = await load(originOf(c.req.url));
    const source = data.covers.get(c.req.param("file"));
    const bytes = source ? await readBytesIfExists(source) : null;
    if (!bytes) return c.json({ error: "Copertina non trovata.", code: "not-found" }, 404);
    // The file name carries the content hash: it never changes.
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  return {
    invalidate() {
      generation += 1;
      cached = undefined;
    },
  };
}
