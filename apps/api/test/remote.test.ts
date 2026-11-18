import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExploration, exploreDataDir, listExplorations, readExploration, DATA_DIR_ENV } from "@ehub/explore/node";
import { mountRemoteFromEnv, unmountAll } from "@ehub/store";
import { createApi } from "../src/app.ts";
import { parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { sessionToken } from "./helpers.ts";
import { createStoreRoutes } from "../src/store-routes.ts";

const SECRET = "k".repeat(40);
let base: string;
let server: { library: string; explore: string; notes: string; podcasts: string };
let clientExplore: string;
let app: ReturnType<typeof createApi>;
let token: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "ehub-remote-"));
  server = {
    library: path.join(base, "s-library"),
    explore: path.join(base, "s-explore"),
    notes: path.join(base, "s-notes"),
    podcasts: path.join(base, "s-podcasts"),
  };
  clientExplore = path.join(base, "c-explore");
  token = await sessionToken(SECRET);
  app = createApi({
    corsOrigins: [],
    auth: { verify: sessionVerifier(SECRET), allowedEmails: parseAllowedEmails("me@example.com") },
    modules: [createStoreRoutes(server)],
  });
});
afterAll(() => rm(base, { recursive: true, force: true }));
afterEach(() => {
  unmountAll();
  delete process.env[DATA_DIR_ENV];
});

const viaApp = ((url: string, init?: RequestInit) => app.request(url, init)) as unknown as typeof fetch;
const authed = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

describe("remote store for the CLIs", () => {
  it("lets the explore repo, mounted remotely, write and read the server's files", async () => {
    process.env[DATA_DIR_ENV] = clientExplore;
    expect(exploreDataDir()).toBe(clientExplore);
    expect(
      mountRemoteFromEnv({ explore: clientExplore }, { EHUB_API_URL: "https://api.test", EHUB_API_TOKEN: token }, viaApp),
    ).toBe(true);

    const created = await createExploration({ title: "Sul tempo", question: "Cos'è?" }, new Date(2026, 10, 12, 10));
    // The document lives on the server side; nothing was written on the client.
    expect(JSON.parse(await readFile(path.join(server.explore, `${created.id}.json`), "utf8")).title).toBe("Sul tempo");
    await expect(readFile(path.join(clientExplore, `${created.id}.json`))).rejects.toThrow();
    expect((await readExploration(created.id)).question).toBe("Cos'è?");
    expect((await listExplorations()).map((e) => e.id)).toEqual([created.id]);
  });

  it("does nothing without the API settings", () => {
    expect(mountRemoteFromEnv({ explore: clientExplore }, {}, viaApp)).toBe(false);
  });

  it("needs a session, refuses odd keys and validates documents before storing them", async () => {
    expect((await app.request("/api/store/explore/x.json")).status).toBe(401);
    const put = (key: string, body: string) =>
      app.request(`/api/store/explore/${key}`, { method: "PUT", headers: authed({ "content-type": "application/json" }), body });
    expect((await put("2026-11-12-x.json", "not json")).status).toBe(400);
    const invalid = await put("2026-11-12-x.json", '{"id":"nope"}');
    expect(invalid.status).toBe(422);
    expect((await app.request("/api/store/explore/..%2Fsecret.json", { headers: authed() })).status).toBe(400);
    expect((await app.request("/api/store/explore/notes.txt", { headers: authed() })).status).toBe(400);
    expect((await app.request("/api/store/nowhere/x.json", { headers: authed() })).status).toBe(404);
    expect((await app.request("/api/store/explore?list=secret", { headers: authed() })).status).toBe(404);
  });
});
