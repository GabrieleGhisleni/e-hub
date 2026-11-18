import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { authMiddleware, type AuthOptions } from "./auth.ts";

export interface ApiOptions {
  /** The modules' Hono apps (routes under /api/...). Built with `access: passThrough`: access is decided here. */
  modules: Hono[];
  auth: AuthOptions;
  /** Origins allowed to call the API from a browser (the GitHub Pages origin, `http://127.0.0.1:5173` in dev). */
  corsOrigins: readonly string[];
}

/** For the modules' `access` option: the checks are done once, by the API. */
export const passThrough: MiddlewareHandler = (_c, next) => next();

export function createApi(options: ApiOptions): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => (options.corsOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );
  app.use("*", authMiddleware(options.auth));
  app.get("/api/health", (c) => c.json({ ok: true }));
  for (const module of options.modules) app.route("/", module);
  app.notFound((c) => c.json({ error: "Endpoint inesistente.", code: "not-found" }, 404));
  return app;
}
