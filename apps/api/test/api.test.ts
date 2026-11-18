import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotesApp } from "@ehub/notes/server";
import { createApi, passThrough } from "../src/app.ts";
import { SESSION_AUDIENCE, SESSION_ISSUER, parseAllowedEmails, sessionVerifier } from "../src/auth.ts";

const SECRET = "x".repeat(40);
const PAGES = "https://user.github.io";
let dir: string;
let app: ReturnType<typeof createApi>;

async function token(claims: { email?: string; secret?: string; aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT({ email: claims.email ?? "me@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(claims.iss ?? SESSION_ISSUER)
    .setAudience(claims.aud ?? SESSION_AUDIENCE)
    .setExpirationTime(claims.exp ?? "1h")
    .sign(new TextEncoder().encode(claims.secret ?? SECRET));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-api-"));
  process.env.EHUB_NOTES_DATA_DIR = dir;
  app = createApi({
    corsOrigins: [PAGES],
    auth: {
      verify: sessionVerifier(SECRET),
      allowedEmails: parseAllowedEmails("Me@Example.com, other@example.com"),
    },
    modules: [createNotesApp({ access: passThrough })],
  });
});
afterAll(async () => {
  delete process.env.EHUB_NOTES_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const note = {
  id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4",
  item: { module: "library", id: "78w462eb", title: "T", href: "/library/book/78w462eb" },
  body: "ciao",
  pinned: false,
};
const post = (headers: Record<string, string> = {}) =>
  app.request("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(note),
  });

describe("hosted API", () => {
  it("answers GETs without a token", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/notes")).status).toBe(200);
  });

  it("refuses writes without or with a bad token", async () => {
    expect((await post()).status).toBe(401);
    expect((await post({ authorization: "Bearer nonsense" })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${await token({ iss: "someone-else" })}` })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${await token({ aud: "anon" })}` })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${await token({ exp: "-1h" })}` })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${await token({ secret: "y".repeat(40) })}` })).status).toBe(401);
  });

  it("refuses an email outside the allowlist", async () => {
    const res = await post({ authorization: `Bearer ${await token({ email: "stranger@example.com" })}` });
    expect(res.status).toBe(403);
  });

  it("lets an allowed email write", async () => {
    const res = await post({ authorization: `Bearer ${await token()}` });
    expect(res.status).toBe(201);
    const list = await (await app.request("/api/notes")).json();
    expect(JSON.stringify(list)).toContain("ciao");
  });

  it("keeps sensitive GETs private", async () => {
    expect((await app.request("/api/podcasts/episodes/x/transcript.md")).status).toBe(401);
    expect((await app.request("/api/library/zlibrary/status")).status).toBe(401);
  });

  it("sends CORS headers only to the allowed origin", async () => {
    const ok = await app.request("/api/notes", {
      method: "OPTIONS",
      headers: { origin: PAGES, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe(PAGES);
    const bad = await app.request("/api/notes", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
