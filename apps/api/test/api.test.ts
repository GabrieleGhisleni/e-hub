import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotesApp } from "@ehub/notes/server";
import { MemoryBlobStore, MemoryDocClient, unmountAll } from "@ehub/store";
import { mountHosted } from "@ehub/store/hosted";
import { createApi, passThrough } from "../src/app.ts";
import { parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { sessionToken } from "./helpers.ts";

const SECRET = "x".repeat(40);
const PAGES = "https://user.github.io";
let dir: string;
let app: ReturnType<typeof createApi>;

const token = (claims: Parameters<typeof sessionToken>[1] = {}) => sessionToken(SECRET, claims);

function build(allowed: string) {
  return createApi({
    corsOrigins: [PAGES],
    auth: { verify: sessionVerifier(SECRET), allowedEmails: parseAllowedEmails(allowed) },
    modules: [createNotesApp({ access: passThrough })],
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-api-"));
  process.env.EHUB_NOTES_DATA_DIR = dir;
  // Notes live in the hosted store (libSQL would work as well: see isolation.test.ts); nothing here touches disk.
  mountHosted(
    { library: path.join(dir, "l"), explore: path.join(dir, "e"), notes: dir, podcasts: path.join(dir, "p") },
    new MemoryDocClient(),
    new MemoryBlobStore(),
  );
  app = build("Me@Example.com, other@example.com");
});
afterAll(async () => {
  unmountAll();
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
  it("answers only the health check without a token: GETs need a session too", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/notes")).status).toBe(401);
    expect((await app.request("/api/explore")).status).toBe(401);
    expect((await app.request("/api/library/site/books")).status).toBe(401);
    expect((await app.request("/api/podcasts/catalog")).status).toBe(401);
    expect((await app.request("/api/podcasts/episodes/x/transcript.md")).status).toBe(401);
    expect((await app.request("/api/library/zlibrary/status")).status).toBe(401);
    expect((await app.request("/api/nope")).status).toBe(401);
  });

  it("refuses a bad token on reads and writes", async () => {
    const bad = [
      { authorization: "Bearer nonsense" },
      { authorization: `Bearer ${await token({ iss: "someone-else" })}` },
      { authorization: `Bearer ${await token({ aud: "anon" })}` },
      { authorization: `Bearer ${await token({ exp: "-1h" })}` },
      { authorization: `Bearer ${await token({ sub: "" })}` },
      { authorization: `Bearer ${await new (await import("jose")).SignJWT({ email: "me@example.com" }).setProtectedHeader({ alg: "HS256" }).setIssuer("ehub-api").setAudience("ehub").setExpirationTime("1h").sign(new TextEncoder().encode(SECRET))}` }, // no sub
    ];
    for (const headers of bad) {
      expect((await post(headers)).status).toBe(401);
      expect((await app.request("/api/notes", { headers })).status).toBe(401);
    }
    expect((await post({ authorization: `Bearer ${await token({ sub: "u9" }).then((t) => t.slice(0, -3) + "abc")}` })).status).toBe(401);
  });

  it("with an allowlist, refuses an email outside it; with none, lets any verified account in", async () => {
    const stranger = { authorization: `Bearer ${await token({ email: "stranger@example.com", sub: "u7" })}` };
    expect((await post(stranger)).status).toBe(403);
    expect((await app.request("/api/notes", { headers: stranger })).status).toBe(403);
    const open = build("");
    expect((await open.request("/api/notes", { headers: stranger })).status).toBe(200);
  });

  it("lets an allowed user write and read their data", async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    expect((await post(headers)).status).toBe(201);
    const list = await (await app.request("/api/notes", { headers })).json();
    expect(JSON.stringify(list)).toContain("ciao");
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
