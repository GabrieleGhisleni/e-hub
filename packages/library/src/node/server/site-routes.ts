/**
 * Read side of the hosted site: the same documents the static site used to publish (`index.json`, one detail per book,
 * the hashed covers), built on demand from the data store. Public (GET); cached for a few seconds and dropped on every
 * write, so an edit shows up at once.
 */
import { currentUserId, readBytesIfExists } from "@ehub/store";
import type { Hono } from "hono";
import { type SiteData, buildSiteData } from "../site-data/build.ts";

/** Fresh for this long; after it the old data is served at once while one rebuild runs in the background. */
const TTL_MS = 30_000;
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
  // One entry per user: the data (and cover paths) of one user must never be served to another.
  const cache = new Map<string, { at: number; origin: string; data: SiteData }>();
  // Cover hashes per user (downloading a cover just to hash it is the slowest part of a build).
  const coverHashes = new Map<string, Map<string, { hash: string; at: number }>>();
  // A build in progress per user and origin: concurrent requests share it instead of each rebuilding everything.
  const building = new Map<string, Promise<SiteData>>();
  let generation = 0;

  const rebuild = (owner: string, origin: string): Promise<SiteData> => {
    const key = `${owner}\n${origin}`;
    const running = building.get(key);
    if (running) return running;
    const started = generation;
    let hashes = coverHashes.get(owner);
    if (!hashes) coverHashes.set(owner, (hashes = new Map()));
    const promise = buildSiteData(options.dataDir, {
      basePath: "/",
      coverBase: `${origin}${SITE}/covers/`,
      coverHashes: hashes,
      now,
    })
      .then((data) => {
        if (started === generation) cache.set(owner, { at: now(), origin, data });
        return data;
      })
      .finally(() => building.delete(key));
    building.set(key, promise);
    return promise;
  };

  const load = async (origin: string): Promise<SiteData> => {
    const owner = currentUserId() ?? "";
    const cached = cache.get(owner);
    if (cached && cached.origin === origin) {
      if (now() - cached.at >= TTL_MS) void rebuild(owner, origin).catch(() => {}); // stale: refresh behind the reply
      return cached.data;
    }
    return rebuild(owner, origin);
  };
  // Behind the tunnel the request arrives as plain http: a public host is always served over https, and an http cover
  // URL on the https site would cost a redirect per image. Loopback (`pnpm dev`) stays as it is.
  const originOf = (url: string) => {
    if (options.publicUrl) return options.publicUrl.replace(/\/+$/, "");
    const u = new URL(url);
    const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) || u.hostname.endsWith(".localhost");
    return local ? u.origin : `https://${u.host}`;
  };

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
      cache.clear();
      coverHashes.clear();
      building.clear();
    },
  };
}
