import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { createGoogleLogin } from "../src/google.ts";

const SECRET = "s".repeat(40);
const SITE = "https://user.github.io";
const CLIENT = "client-id.apps.googleusercontent.com";

async function setup(emailVerified = true) {
  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "g1", alg: "RS256", use: "sig" };
  const calls: { url: string; body: string }[] = [];
  const idToken = (email: string, aud = CLIENT) =>
    new SignJWT({ email, email_verified: emailVerified })
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const make = (email: string, aud?: string) =>
    createGoogleLogin({
      clientId: CLIENT,
      clientSecret: "shh",
      publicUrl: "https://api.example.com",
      sessionSecret: SECRET,
      allowedEmails: parseAllowedEmails("me@example.com"),
      siteOrigins: [SITE],
      verify: sessionVerifier(SECRET),
      googleKeys: createLocalJWKSet({ keys: [jwk] }),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return Response.json({ id_token: await idToken(email, aud) });
      }) as unknown as typeof fetch,
    });
  return { make, calls };
}

async function start(app: ReturnType<typeof createGoogleLogin>) {
  const res = await app.request(`/auth/google?return=${encodeURIComponent(`${SITE}/e-hub/`)}`);
  const location = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return { res, location, cookie };
}

describe("Google login", () => {
  it("sends the browser to Google with PKCE and a state", async () => {
    const { make } = await setup();
    const { res, location } = await start(make("me@example.com"));
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("redirect_uri")).toBe("https://api.example.com/auth/google/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("scope")).toBe("openid email");
  });

  it("refuses a return address outside the site origins", async () => {
    const { make } = await setup();
    const res = await make("me@example.com").request(`/auth/google?return=${encodeURIComponent("https://evil.example/")}`);
    expect(res.status).toBe(400);
  });

  it("completes the login for an allowed email and puts the token in the fragment", async () => {
    const { make, calls } = await setup();
    const app = make("Me@Example.com");
    const { location, cookie } = await start(app);
    const cb = await app.request(`/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`, {
      headers: { cookie },
    });
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(`${SITE}/e-hub/`);
    const token = new URLSearchParams(back.hash.slice(1)).get("token")!;
    expect(await sessionVerifier(SECRET)(token)).toEqual({ email: "me@example.com" });
    expect(calls[0]!.body).toContain("code_verifier=");
    const me = await app.request("/auth/me", { headers: { authorization: `Bearer ${token}` } });
    expect(await me.json()).toEqual({ email: "me@example.com" });
  });

  it("refuses an email outside the allowlist", async () => {
    const { make } = await setup();
    const app = make("stranger@example.com");
    const { location, cookie } = await start(app);
    const cb = await app.request(`/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`, { headers: { cookie } });
    expect(cb.status).toBe(403);
  });

  it("refuses a callback without the cookie of the browser that started the login", async () => {
    const { make } = await setup();
    const app = make("me@example.com");
    const { location } = await start(app);
    const cb = await app.request(`/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`);
    expect(cb.status).toBe(400);
  });

  it("refuses an id token for another client and an unverified email", async () => {
    const wrongAud = await setup();
    const a = wrongAud.make("me@example.com", "other-client");
    const s1 = await start(a);
    expect((await a.request(`/auth/google/callback?code=x&state=${s1.location.searchParams.get("state")}`, { headers: { cookie: s1.cookie } })).status).toBe(400);
    const unverified = await setup(false);
    const b = unverified.make("me@example.com");
    const s2 = await start(b);
    expect((await b.request(`/auth/google/callback?code=x&state=${s2.location.searchParams.get("state")}`, { headers: { cookie: s2.cookie } })).status).toBe(400);
  });
});
