/**
 * `/api/store/<root>/<key>`: the raw documents of a data dir, for the CLIs on the laptop (packages/store/src/remote.ts).
 * Everything here needs a session (see PRIVATE_GETS), only keys of the package layouts are reachable, and a JSON write
 * is validated against the schema of its table before it is stored.
 */
import path from "node:path";
import { Hono } from "hono";
import type { ZodType } from "zod";
import {
  type DataRoots,
  LAYOUTS,
  routeFor,
} from "@ehub/store/hosted";
import { listDir, readBytesIfExists, removeFile, removeTree, writeFileAtomic } from "@ehub/store";
import { TABLE_SCHEMAS } from "./validators.ts";

const MAX_BYTES = 8 * 1024 * 1024;

function safeKey(raw: string): string | null {
  const segments = raw.split("/").map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return "\0";
    }
  });
  if (segments.length === 0 || segments.some((s) => s === "" || s === "." || s === ".." || /[\0\\]/.test(s))) {
    return null;
  }
  return segments.join("/");
}

export function createStoreRoutes(
  dirs: DataRoots,
  schemas: Record<string, ZodType> = TABLE_SCHEMAS,
): Hono {
  const app = new Hono();
  const bad = (c: import("hono").Context, message: string, status: 400 | 404 | 413 = 400) =>
    c.json({ error: message, code: "bad-store-request" }, status);

  app.use("/api/store/:root/*", async (c, next) => {
    if (!(c.req.param("root") in dirs)) return bad(c, "Radice sconosciuta.", 404);
    await next();
  });

  // Directory listing: only the listed directories of the layout.
  app.get("/api/store/:root", async (c) => {
    const root = c.req.param("root") as keyof DataRoots;
    if (!(root in dirs)) return bad(c, "Radice sconosciuta.", 404);
    const prefix = c.req.query("list") ?? "";
    if (!LAYOUTS[root].listings.some((l) => l.dir === prefix)) return bad(c, "Cartella non elencabile.", 404);
    return c.json(await listDir(path.join(dirs[root], prefix)));
  });

  const keyOf = (c: import("hono").Context): string | null => {
    const root = c.req.param("root");
    const prefix = `/api/store/${root}/`;
    const pathname = new URL(c.req.url).pathname;
    return safeKey(pathname.slice(pathname.indexOf(prefix) + prefix.length));
  };

  app.get("/api/store/:root/*", async (c) => {
    const root = c.req.param("root") as keyof DataRoots;
    const key = keyOf(c);
    if (!key || !routeFor(LAYOUTS[root], key)) return bad(c, "Chiave non valida.");
    const bytes = await readBytesIfExists(path.join(dirs[root], key));
    if (!bytes) return bad(c, "Non trovato.", 404);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });

  app.put("/api/store/:root/*", async (c) => {
    const root = c.req.param("root") as keyof DataRoots;
    const key = keyOf(c);
    const hit = key ? routeFor(LAYOUTS[root], key) : null;
    if (!key || !hit) return bad(c, "Chiave non valida.");
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length > MAX_BYTES && hit.route.kind !== "blob") return bad(c, "Documento troppo grande.", 413);
    if (hit.route.kind === "json") {
      const schema = schemas[hit.route.table];
      let value: unknown;
      try {
        value = JSON.parse(Buffer.from(body).toString("utf8"));
      } catch {
        return bad(c, "JSON non valido.");
      }
      const parsed = schema?.safeParse(value);
      if (schema && !parsed?.success) {
        return c.json(
          { error: "Documento non valido.", code: "invalid-document", details: parsed?.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
          422,
        );
      }
    }
    await writeFileAtomic(path.join(dirs[root], key), body);
    return c.body(null, 204);
  });

  app.delete("/api/store/:root/*", async (c) => {
    const root = c.req.param("root") as keyof DataRoots;
    const key = keyOf(c);
    if (!key) return bad(c, "Chiave non valida.");
    if (c.req.query("tree") === "1") {
      await removeTree(path.join(dirs[root], key));
      return c.body(null, 204);
    }
    if (!routeFor(LAYOUTS[root], key)) return bad(c, "Chiave non valida.");
    await removeFile(path.join(dirs[root], key));
    return c.body(null, 204);
  });

  return app;
}
