/**
 * Google login handled by the API itself (authorization code flow with PKCE). The browser is sent to Google, comes
 * back to `/auth/google/callback` on the API, and is redirected to the site with a session token in the URL
 * fragment (`#token=...`), which never reaches a server. Only emails in the allowlist get a token.
 *
 *   GET /auth/google?return=<site url>   start; `return` must belong to an allowed site origin
 *   GET /auth/google/callback            Google's redirect
 *   GET /auth/me                         who the token is (Bearer)
 */
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { createSession, type VerifyToken } from "./auth.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const NONCE_COOKIE = "ehub_oauth";

export interface GoogleLoginOptions {
  clientId: string;
  clientSecret: string;
  /** Public URL of this API, e.g. `https://api.example.com` (the redirect URI is `<this>/auth/google/callback`). */
  publicUrl: string;
  /** Secret that signs the session tokens and the login state (>= 32 characters). */
  sessionSecret: string;
  allowedEmails: ReadonlySet<string>;
  /** Origins of the site: after login the browser may only be sent back to one of these. */
  siteOrigins: readonly string[];
  verify: VerifyToken;
  /** Test seams. */
  fetch?: typeof fetch;
  googleKeys?: JWTVerifyGetKey;
  now?: () => Date;
}

const enc = new TextEncoder();
const b64url = (buf: Buffer) => buf.toString("base64url");

export function createGoogleLogin(options: GoogleLoginOptions): Hono {
  const app = new Hono();
  const fetchImpl = options.fetch ?? fetch;
  const keys = options.googleKeys ?? createRemoteJWKSet(new URL(GOOGLE_CERTS));
  const stateKey = enc.encode(options.sessionSecret);
  const redirectUri = `${options.publicUrl.replace(/\/+$/, "")}/auth/google/callback`;
  const secure = redirectUri.startsWith("https://");

  const allowedReturn = (value: string | undefined): URL | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return options.siteOrigins.includes(url.origin) ? url : null;
    } catch {
      return null;
    }
  };

  app.get("/auth/google", async (c) => {
    const back = allowedReturn(c.req.query("return"));
    if (!back) return c.json({ error: "Indirizzo di ritorno non consentito.", code: "bad-return" }, 400);
    const nonce = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const state = await new SignJWT({ nonce, verifier, returnTo: back.toString() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("ehub-login")
      .setExpirationTime("10m")
      .sign(stateKey);
    setCookie(c, NONCE_COOKIE, nonce, { httpOnly: true, secure, sameSite: "Lax", path: "/auth", maxAge: 600 });
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/auth/google/callback", async (c) => {
    const fail = (message: string, status: 400 | 403 = 400) => c.json({ error: message, code: "login-failed" }, status);
    const code = c.req.query("code");
    const rawState = c.req.query("state");
    if (!code || !rawState) return fail("Risposta di Google incompleta.");
    let state: { nonce: string; verifier: string; returnTo: string };
    try {
      const { payload } = await jwtVerify(rawState, stateKey, { issuer: "ehub-login", algorithms: ["HS256"] });
      state = payload as unknown as typeof state;
    } catch {
      return fail("Accesso scaduto: riprova.");
    }
    const cookie = getCookie(c, NONCE_COOKIE);
    deleteCookie(c, NONCE_COOKIE, { path: "/auth" });
    if (!cookie || cookie !== state.nonce) return fail("Accesso non iniziato da questo browser.");
    const back = allowedReturn(state.returnTo);
    if (!back) return fail("Indirizzo di ritorno non consentito.");

    const tokenResponse = await fetchImpl(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: state.verifier,
      }),
    });
    if (!tokenResponse.ok) return fail("Google ha rifiutato il codice.");
    const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
    if (!idToken) return fail("Google non ha restituito l'identità.");
    let email = "";
    try {
      const { payload } = await jwtVerify(idToken, keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: options.clientId,
      });
      if (payload.email_verified !== true || typeof payload.email !== "string") throw new Error("unverified");
      email = payload.email.toLowerCase();
    } catch {
      return fail("Identità Google non valida.");
    }
    if (!options.allowedEmails.has(email)) return fail("Questo account non è autorizzato.", 403);

    const token = await createSession(options.sessionSecret, email, options.now?.());
    back.hash = new URLSearchParams({ token }).toString();
    return c.redirect(back.toString(), 302);
  });

  app.get("/auth/me", async (c) => {
    const token = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json({ error: "Accesso richiesto.", code: "unauthorized" }, 401);
    try {
      const { email } = await options.verify(token);
      return c.json({ email });
    } catch {
      return c.json({ error: "Sessione non valida o scaduta.", code: "unauthorized" }, 401);
    }
  });

  return app;
}
