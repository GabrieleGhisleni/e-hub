/**
 * `pnpm dev` only: `POST /auth/dev` answers with a session token for the owner (`API_DEV_OWNER_EMAIL`), so the page on
 * this machine needs no Google login while working on the real database. Mounted by main.ts only when the variable is
 * set and the server listens on loopback; the owner must already exist (they logged in once with Google).
 */
import { Hono } from "hono";
import type { DocClient } from "@ehub/store";
import { createSession } from "./auth.ts";

/** Headers a tunnel or a proxy adds: a request that has them did not come from this machine. */
const FORWARDED = ["x-forwarded-for", "forwarded", "cf-connecting-ip", "cf-ray", "tailscale-user-login"];
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function createDevLogin(options: { docs: DocClient; sessionSecret: string; ownerEmail: string }): Hono {
  const app = new Hono();
  app.post("/auth/dev", async (c) => {
    // Defence in depth: the Pi also listens on loopback behind its tunnel, so loopback alone proves nothing. Only a
    // request addressed to loopback and carrying no proxy header (the Vite proxy sets none) gets a session.
    const host = c.req.header("host") ?? "";
    if (!LOOPBACK_HOST.test(host) || FORWARDED.some((name) => c.req.header(name) !== undefined)) {
      return c.json({ error: "Non disponibile.", code: "forbidden" }, 403);
    }
    const owner = await options.docs.users.findByEmail(options.ownerEmail);
    if (!owner) {
      return c.json({ error: "Il proprietario non esiste ancora nel database: accedi una volta con Google.", code: "not-found" }, 404);
    }
    const token = await createSession(options.sessionSecret, { userId: owner.id, email: owner.email });
    return c.json({ token, email: owner.email });
  });
  return app;
}
