import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/app.ts";
import { parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { createGoogleLogin } from "../src/google.ts";

const SECRET = "s".repeat(40);
const CLIENT = "client-id.apps.googleusercontent.com";
const NOW = new Date("2026-11-18T10:00:00Z");

async function setup() {
  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "g1", alg: "RS256", use: "sig" };
  const idToken = (claims: { email?: string; aud?: string; verified?: boolean; iss?: string } = {}) =>
    new SignJWT({ email: claims.email ?? "me@example.com", email_verified: claims.verified ?? true })
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer(claims.iss ?? "https://accounts.google.com")
      .setAudience(claims.aud ?? CLIENT)
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const verify = sessionVerifier(SECRET);
  const login = createGoogleLogin({
    clientId: CLIENT,
    sessionSecret: SECRET,
    allowedEmails: parseAllowedEmails("me@example.com"),
    verify,
    googleKeys: createLocalJWKSet({ keys: [jwk] }),
    now: () => NOW,
  });
  // Through the real API wrapper: the login is the one POST that needs no session.
  const app = createApi({
    corsOrigins: ["https://user.github.io"],
    auth: { verify, allowedEmails: parseAllowedEmails("me@example.com") },
    modules: [login],
  });
  const post = (credential: string) =>
    app.request("/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://user.github.io" },
      body: JSON.stringify({ credential }),
    });
  return { app, idToken, post };
}

describe("Google login (ID token)", () => {
  it("exchanges a valid Google ID token for a 30-day session token", async () => {
    const { app, idToken, post } = await setup();
    const res = await post(await idToken({ email: "Me@Example.com" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://user.github.io");
    const body = (await res.json()) as { token: string; email: string; expiresAt: string };
    expect(body.email).toBe("me@example.com");
    expect(body.expiresAt).toBe("2026-12-18T10:00:00.000Z");
    expect(await sessionVerifier(SECRET)(body.token)).toEqual({ email: "me@example.com" });
    const me = await app.request("/auth/me", { headers: { authorization: `Bearer ${body.token}` } });
    expect(await me.json()).toEqual({ email: "me@example.com" });
  });

  it("refuses an email outside the allowlist (403)", async () => {
    const { idToken, post } = await setup();
    expect((await post(await idToken({ email: "stranger@example.com" }))).status).toBe(403);
  });

  it("refuses a token for another client, another issuer, an unverified email or garbage (401)", async () => {
    const { idToken, post } = await setup();
    expect((await post(await idToken({ aud: "other-client" }))).status).toBe(401);
    expect((await post(await idToken({ iss: "https://evil.example" }))).status).toBe(401);
    expect((await post(await idToken({ verified: false }))).status).toBe(401);
    expect((await post("x".repeat(40))).status).toBe(401);
  });

  it("refuses a malformed body (400) and /auth/me without a token (401)", async () => {
    const { app } = await setup();
    const bad = await app.request("/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400);
    expect((await app.request("/auth/me")).status).toBe(401);
  });
});
