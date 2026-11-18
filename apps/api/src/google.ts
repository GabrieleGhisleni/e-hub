/**
 * Login with Google, Google Identity Services style: the site gets an ID token from Google in the browser and posts it
 * here; the API checks it (Google's public keys, our client id, verified email, allowlist) and answers with its own
 * session token. No redirect and no cookie, so it works with the site and the API on different domains.
 *
 *   POST /auth/google  {credential}  ->  {token, email, name, kobo, expiresAt}
 *   GET  /auth/me      (Bearer)      ->  {email, name, kobo}
 *
 * Only emails of the (mandatory) `ALLOWED_EMAILS` may log in; an empty list admits nobody. The user
 * (id = Google `sub`) is created or updated at every login; `kobo` tells the site whether to show the Kobo section.
 */
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { type BlobStore, type DocClient, UserConflictError, loginUser } from "@ehub/store";
import { SESSION_TTL_SECONDS, createSession, type VerifyToken } from "./auth.ts";

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

export interface GoogleLoginOptions {
  clientId: string;
  /** Secret that signs the session tokens (>= 32 characters). */
  sessionSecret: string;
  /** Mandatory. Empty = nobody can log in. */
  allowedEmails: ReadonlySet<string>;
  verify: VerifyToken;
  /** Where users live; R2 is needed only to move the files of an owner prepared by the data migration. */
  docs: DocClient;
  blobs?: BlobStore | null;
  /** Whether the Kobo section is available to this email (the owner only). */
  koboFor?: (email: string) => boolean;
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
    let sub: string;
    let name: string;
    try {
      const { payload } = await jwtVerify(parsed.data.credential, keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: options.clientId,
      });
      if (payload.email_verified !== true || typeof payload.email !== "string") throw new Error("unverified");
      if (typeof payload.sub !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.sub)) throw new Error("sub");
      email = payload.email.toLowerCase();
      sub = payload.sub;
      name = typeof payload.name === "string" ? payload.name.slice(0, 200) : "";
    } catch {
      return c.json({ error: "Identità Google non valida.", code: "unauthorized" }, 401);
    }
    if (!options.allowedEmails.has(email)) {
      return c.json({ error: "Account non abilitato.", code: "forbidden" }, 403);
    }
    try {
      await loginUser(options.docs, options.blobs ?? null, { sub, email, name });
    } catch (error) {
      if (error instanceof UserConflictError) return c.json({ error: error.message, code: "forbidden" }, 403);
      throw error;
    }
    const issued = now();
    const token = await createSession(options.sessionSecret, { userId: sub, email }, issued);
    return c.json({
      token,
      email,
      name,
      kobo: options.koboFor?.(email) ?? false,
      expiresAt: new Date(issued.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    });
  });

  app.get("/auth/me", async (c) => {
    const token = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json({ error: "Accesso richiesto.", code: "unauthorized" }, 401);
    try {
      const identity = await options.verify(token);
      const user = await options.docs.users.findById(identity.userId);
      return c.json({
        email: identity.email,
        name: user?.name ?? "",
        kobo: options.koboFor?.(identity.email) ?? false,
      });
    } catch {
      return c.json({ error: "Sessione non valida o scaduta.", code: "unauthorized" }, 401);
    }
  });

  return app;
}
