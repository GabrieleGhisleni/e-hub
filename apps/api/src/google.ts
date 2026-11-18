/**
 * Login with Google, Google Identity Services style: the site gets an ID token from Google in the browser and posts it
 * here; the API checks it (Google's public keys, our client id, verified email, allowlist) and answers with its own
 * session token. No redirect and no cookie, so it works with the site and the API on different domains.
 *
 *   POST /auth/google  {credential}  ->  {token, email, expiresAt}
 *   GET  /auth/me      (Bearer)      ->  {email}
 */
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { SESSION_TTL_SECONDS, createSession, type VerifyToken } from "./auth.ts";

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

export interface GoogleLoginOptions {
  clientId: string;
  /** Secret that signs the session tokens (>= 32 characters). */
  sessionSecret: string;
  allowedEmails: ReadonlySet<string>;
  verify: VerifyToken;
  /** Test seams. */
  googleKeys?: JWTVerifyGetKey;
  now?: () => Date;
}

const Body = z.strictObject({ credential: z.string().min(20).max(8192) });

export function createGoogleLogin(options: GoogleLoginOptions): Hono {
  const app = new Hono();
  const keys = options.googleKeys ?? createRemoteJWKSet(new URL(GOOGLE_CERTS));
  const now = options.now ?? (() => new Date());

  app.post("/auth/google", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Richiesta non valida.", code: "bad-request" }, 400);
    let email: string;
    try {
      const { payload } = await jwtVerify(parsed.data.credential, keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: options.clientId,
      });
      if (payload.email_verified !== true || typeof payload.email !== "string") throw new Error("unverified");
      email = payload.email.toLowerCase();
    } catch {
      return c.json({ error: "Identità Google non valida.", code: "unauthorized" }, 401);
    }
    if (!options.allowedEmails.has(email)) {
      return c.json({ error: "Questo account non è autorizzato.", code: "forbidden" }, 403);
    }
    const issued = now();
    const token = await createSession(options.sessionSecret, email, issued);
    return c.json({
      token,
      email,
      expiresAt: new Date(issued.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    });
  });

  app.get("/auth/me", async (c) => {
    const token = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json({ error: "Accesso richiesto.", code: "unauthorized" }, 401);
    try {
      return c.json({ email: (await options.verify(token)).email });
    } catch {
      return c.json({ error: "Sessione non valida o scaduta.", code: "unauthorized" }, 401);
    }
  });

  return app;
}
