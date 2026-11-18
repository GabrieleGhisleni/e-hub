/** The public demo: anonymous GETs are served as the reserved user `demo`, never anything else, never writes. */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExploreApp } from "@ehub/explore/server";
import { createNotesApp } from "@ehub/notes/server";
import { createApp as createPodcastsApp } from "@ehub/podcasts/server";
import {
  DEMO_USER_ID,
  MemoryBlobStore,
  TursoDocClient,
  applyMigrations,
  demoRoots,
  planMigration,
  seedDemo,
  unmountAll,
} from "@ehub/store";
import { LAYOUTS, mountHosted, routeFor } from "@ehub/store/hosted";
import { createApi, passThrough } from "../src/app.ts";
import { DEMO_GETS, parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { createStoreRoutes } from "../src/store-routes.ts";
import { TABLE_SCHEMAS } from "../src/validators.ts";
import { sessionToken } from "./helpers.ts";

const SECRET = "d".repeat(40);
const SEED = path.resolve(import.meta.dirname, "../../../demo/seed");
let dir: string;
let app: ReturnType<typeof createApi>;
let docs: TursoDocClient;
let blobs: MemoryBlobStore;
let A: Record<string, string>;
const json = { "content-type": "application/json" };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-demo-"));
  const roots = {
    library: path.join(dir, "library"),
    explore: path.join(dir, "explore"),
    notes: path.join(dir, "notes"),
    podcasts: path.join(dir, "podcasts"),
  };
  process.env.EHUB_NOTES_DATA_DIR = roots.notes;
  process.env.EHUB_EXPLORE_DATA_DIR = roots.explore;
  process.env.E_PODCASTS_DATA_DIR = roots.podcasts;
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: ":memory:" });
  const migrations = new URL("../../../turso/migrations/", import.meta.url);
  const files = await Promise.all(
    (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort().map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrations), "utf8"),
    })),
  );
  await applyMigrations(client as never, files);
  docs = new TursoDocClient(client as never);
  blobs = new MemoryBlobStore();
  mountHosted(roots, docs, blobs);
  app = createApi({
    corsOrigins: [],
    auth: { verify: sessionVerifier(SECRET), allowedEmails: parseAllowedEmails("a@example.com") },
    modules: [
      createNotesApp({ access: passThrough }),
      createExploreApp({ access: passThrough }),
      createPodcastsApp({ access: passThrough }),
      createStoreRoutes(roots),
    ],
  });
  A = { authorization: `Bearer ${await sessionToken(SECRET, { sub: "userA", email: "a@example.com" })}` };
  // A real user with data of their own, then the demo.
  await app.request("/api/notes", {
    method: "POST",
    headers: { ...A, ...json },
    body: JSON.stringify({
      id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4",
      item: { module: "library", id: "78w462eb", title: "T", href: "/library/book/78w462eb" },
      body: "nota privata di A",
      pinned: false,
    }),
  });
  await seedDemo(docs, blobs, SEED);
});
afterAll(async () => {
  unmountAll();
  for (const k of ["EHUB_NOTES_DATA_DIR", "EHUB_EXPLORE_DATA_DIR", "E_PODCASTS_DATA_DIR"]) delete process.env[k];
  await rm(dir, { recursive: true, force: true });
});

const bodies = async (url: string, headers?: Record<string, string>) => JSON.stringify(await (await app.request(url, { headers })).json());

describe("demo fixtures", () => {
  it("are valid for the schemas the API enforces, and use no real data", async () => {
    const plan = await planMigration(demoRoots(SEED), path.join(SEED, ".none"));
    expect(plan.skipped).toEqual([]);
    expect(plan.items.length).toBeGreaterThanOrEqual(10);
    for (const item of plan.items) {
      const hit = routeFor(LAYOUTS[item.root as keyof typeof LAYOUTS], item.key)!;
      expect(hit, item.key).toBeTruthy();
      if (hit.route.kind !== "json") continue;
      const schema = TABLE_SCHEMAS[hit.route.table];
      const parsed = schema?.safeParse(JSON.parse(await readFile(item.file, "utf8")));
      expect(parsed?.success, `${item.key}: ${parsed?.success ? "" : JSON.stringify(parsed?.error.issues)}`).toBe(true);
    }
  });
});

describe("anonymous GETs", () => {
  it("serve only the demo's data", async () => {
    const notes = await bodies("/api/notes");
    expect(notes).toContain("Machiavelli");
    expect(notes).not.toContain("nota privata di A");
    expect(await bodies("/api/explore")).toContain("il-potere-e-la-misura");
    expect(await bodies("/api/podcasts/catalog")).toContain("conversazioni-di-prova");
  });

  it("a logged-in user sees none of the demo, and the demo none of theirs", async () => {
    const mine = await bodies("/api/notes", A);
    expect(mine).toContain("nota privata di A");
    expect(mine).not.toContain("Machiavelli");
    expect(await bodies("/api/explore", A)).not.toContain("il-potere-e-la-misura");
    expect(await bodies("/api/podcasts/catalog", A)).not.toContain("conversazioni-di-prova");
    expect(await bodies("/api/notes")).not.toContain("nota privata di A");
  });

  it("writes and actions without a token are 401", async () => {
    const note = { id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c5", item: { module: "library", id: "d3mq1x8k", title: "T", href: "/library/book/d3mq1x8k" }, body: "x", pinned: false };
    for (const [method, url, body] of [
      ["POST", "/api/notes", JSON.stringify(note)],
      ["PATCH", "/api/notes/library/d3mq1x8k/3b1f6c52-8a0e-4c1d-9a27-5d4e0c6f1a01", "{}"],
      ["DELETE", "/api/notes/library/d3mq1x8k/3b1f6c52-8a0e-4c1d-9a27-5d4e0c6f1a01", undefined],
      ["POST", "/api/explore", "{}"],
      ["PUT", "/api/explore/2026-11-12-il-potere-e-la-misura/notebook", "{}"],
      ["PUT", "/api/store/notes/library/d3mq1x8k.json", "{}"],
      ["DELETE", "/api/store/notes/library/d3mq1x8k.json", undefined],
      ["POST", "/api/library/kobo/sync", undefined],
      ["POST", "/api/library/uploads", undefined],
      ["POST", "/api/chat", "{}"],
      ["POST", "/api/podcasts/episodes", "{}"],
    ] as const) {
      const res = await app.request(url, { method, headers: json, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${url}`).toBe(401);
    }
    expect(await bodies("/api/notes")).toContain("Machiavelli");
  });

  it("everything outside the demo's read routes stays 401", async () => {
    for (const url of [
      "/api/store/notes/library/d3mq1x8k.json",
      "/api/store/notes?list=library",
      "/api/explore/2026-11-12-il-potere-e-la-misura/summaries",
      "/api/explore/kobo",
      "/api/library/kobo/queue",
      "/api/library/zlibrary/status",
      "/api/library/uploads/x",
      "/api/podcasts/episodes/conversazioni-di-prova-il-valore-del-tempo/transcript.md",
      "/api/podcasts/episodes/conversazioni-di-prova-il-valore-del-tempo/conversations",
      "/api/chat/anything",
    ]) {
      expect((await app.request(url)).status, url).toBe(401);
    }
    expect(DEMO_GETS.some((re) => re.test("/api/library/site/index.json"))).toBe(true);
    expect(DEMO_GETS.some((re) => re.test("/api/library/site/covers/d3mq1x8k.webp"))).toBe(true);
    expect(DEMO_GETS.some((re) => re.test("/api/library/site/../books"))).toBe(false);
  });

  it("a wrong token never falls back to the demo, and `demo` cannot have a session", async () => {
    expect((await app.request("/api/notes", { headers: { authorization: "Bearer nonsense" } })).status).toBe(401);
    const demoToken = await sessionToken(SECRET, { sub: DEMO_USER_ID, email: "a@example.com" });
    expect((await app.request("/api/notes", { headers: { authorization: `Bearer ${demoToken}` } })).status).toBe(401);
  });
});

describe("seed-demo", () => {
  it("is idempotent and only rewrites the demo's rows", async () => {
    const count = async (user: string) => (await docs.forUser(user).list("notes")).length + (await docs.forUser(user).list("books")).length;
    const before = [await count(DEMO_USER_ID), await count("userA"), blobs.objects.size];
    const again = await seedDemo(docs, blobs, SEED);
    expect(again.failed).toEqual([]);
    expect([await count(DEMO_USER_ID), await count("userA"), blobs.objects.size]).toEqual(before);
    expect([...blobs.objects.keys()].every((k) => k.startsWith("users/demo/"))).toBe(true);
    expect((await docs.users.findById(DEMO_USER_ID))?.email).toBe("demo@demo.invalid");
  });
});
