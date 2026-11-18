/**
 * Access rules of the hosted API (docs/hosting.md): reads are public, everything else needs the Supabase JWT of an
 * allowed email. The token only proves who is calling: the Pi checks it against Supabase's public keys (JWKS), so
 * no Supabase secret is needed for this.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";

export interface Identity {
  email: string;
}

/** Resolves a bearer token to an identity, or throws. */
export type VerifyToken = (token: string) => Promise<Identity>;

export interface JwtOptions {
  /** `https://<ref>.supabase.co/auth/v1` */
  issuer: string;
  /** Test seam: a key set instead of the remote JWKS. */
  keys?: JWTVerifyGetKey;
}

export function jwtVerifier(options: JwtOptions): VerifyToken {
  const issuer = options.issuer.replace(/\/+$/, "");
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: "authenticated" });
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
  /^\/api\/podcasts\/episodes\/[^/]+\/transcript/,
  /^\/api\/library\/uploads(\/|$)/,
  /^\/api\/library\/books\/[^/]+\/cover-candidates/,
  /^\/api\/library\/zlibrary/,
  /^\/api\/explore\/[^/]+\/summaries$/,
  /^\/api\/explore\/kobo/,
];

const PUBLIC_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
