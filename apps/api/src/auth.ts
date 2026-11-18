/**
 * Access rules of the hosted API (docs/hosting.md): everything needs a session token (30 days), GET included. The only
 * routes without one are the login itself, the health check and the CORS preflight.
 * The token is issued by this API after a Google login (google.ts), carries the user's Google `sub` and email, and is
 * checked here with the API's own secret. Every request then runs as that user (`runAsUser` from @ehub/store): the
 * storage layer reads the user from there, so no route can touch data of somebody else.
 */
import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { runAsUser } from "@ehub/store";

export interface Identity {
  /** Google `sub`: the id of the user in the database. */
  userId: string;
  email: string;
}

/** Resolves a bearer token to an identity, or throws. */
export type VerifyToken = (token: string) => Promise<Identity>;

export const SESSION_ISSUER = "ehub-api";
export const SESSION_AUDIENCE = "ehub";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/** Signs a session token (HS256) for a user. Issued by the Google login only after the allowlist check. */
export async function createSession(secret: string, identity: Identity, now = new Date()): Promise<string> {
  return new SignJWT({ email: identity.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.userId)
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
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    if (!email || !userId) throw new Error("token without subject or email");
    return { userId, email };
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

/** Reachable without a session: the login (the caller has none yet) and the health check. */
const PUBLIC_ROUTES = new Set(["POST /auth/google", "GET /api/health", "HEAD /api/health"]);

export interface AuthOptions {
  verify: VerifyToken;
  /** Optional allowlist: empty means every verified Google account may log in; otherwise only these emails. */
  allowedEmails: ReadonlySet<string>;
  /**
   * `false` (API_LOCAL_DEV, plain files, no database): the request is authenticated but not scoped to a user, since
   * local files have no owner. Default `true`.
   */
  scopeToUser?: boolean;
}

function deny(status: 401 | 403, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export function authMiddleware(options: AuthOptions): MiddlewareHandler {
  const scope = options.scopeToUser ?? true;
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method === "OPTIONS" || PUBLIC_ROUTES.has(`${c.req.method} ${path}`)) return next();
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer (.+)$/i.exec(header)?.[1];
    if (!token) return deny(401, "unauthorized", "Accesso richiesto.");
    let identity: Identity;
    try {
      identity = await options.verify(token);
    } catch {
      return deny(401, "unauthorized", "Sessione non valida o scaduta.");
    }
    // Checked on every request, not only at login: removing an email from the allowlist locks that user out at once.
    if (options.allowedEmails.size > 0 && !options.allowedEmails.has(identity.email)) {
      return deny(403, "forbidden", "Questo account non è autorizzato.");
    }
    c.set("userId", identity.userId);
    c.set("email", identity.email);
    if (!scope) return next();
    return runAsUser(identity.userId, () => next(), { email: identity.email });
  };
}
