/**
 * Access rules of the hosted API (docs/hosting.md): reads are public, everything else needs a session token (30 days).
 * The token is issued by this API after a Google login (google.ts) for an email in the allowlist, and is checked here
 * with the API's own secret.
 */
import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

export interface Identity {
  email: string;
}

/** Resolves a bearer token to an identity, or throws. */
export type VerifyToken = (token: string) => Promise<Identity>;

export const SESSION_ISSUER = "ehub-api";
export const SESSION_AUDIENCE = "ehub";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/** Signs a session token (HS256) for `email`. Issued by the Google login only after the allowlist check. */
export async function createSession(secret: string, email: string, now = new Date()): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

export function sessionVerifier(secret: string): VerifyToken {
  const key = encoder.encode(secret);
  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!email) throw new Error("token without email");
    return { email };
  };
}

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * GET routes that stay private even though they are reads: transcripts of podcasts, the upload staging area, cover
 * candidates, the Z-Library status and the exploration summaries (derived from book text).
 */
export const PRIVATE_GETS: readonly RegExp[] = [
  /^\/api\/store(\/|$)/,
  /^\/api\/podcasts\/episodes\/[^/]+\/transcript/,
  /^\/api\/library\/uploads(\/|$)/,
  /^\/api\/library\/books\/[^/]+\/cover-candidates/,
  /^\/api\/library\/zlibrary/,
  /^\/api\/explore\/[^/]+\/summaries$/,
  /^\/api\/explore\/kobo/,
];

const PUBLIC_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** The login itself: the caller has no session yet. */
const PUBLIC_POSTS = new Set(["/auth/google"]);

export interface AuthOptions {
  verify: VerifyToken;
  allowedEmails: ReadonlySet<string>;
  privateGets?: readonly RegExp[];
}

function deny(status: 401 | 403, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export function authMiddleware(options: AuthOptions): MiddlewareHandler {
  const privateGets = options.privateGets ?? PRIVATE_GETS;
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method === "POST" && PUBLIC_POSTS.has(path)) return next();
    if (PUBLIC_METHODS.has(c.req.method) && !privateGets.some((re) => re.test(path))) {
      return next();
    }
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer (.+)$/i.exec(header)?.[1];
    if (!token) return deny(401, "unauthorized", "Accesso richiesto.");
    let identity: Identity;
    try {
      identity = await options.verify(token);
    } catch {
      return deny(401, "unauthorized", "Sessione non valida o scaduta.");
    }
    if (!options.allowedEmails.has(identity.email)) {
      return deny(403, "forbidden", "Questo account non è autorizzato.");
    }
    c.set("email", identity.email);
    return next();
  };
}
