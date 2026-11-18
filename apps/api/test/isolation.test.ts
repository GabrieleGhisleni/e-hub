/** One user never sees, changes or deletes the data of another: through the API, on a real (in-memory) libSQL database. */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotesApp } from "@ehub/notes/server";
import { MemoryBlobStore, TursoDocClient, applyMigrations, unmountAll } from "@ehub/store";
import { mountHosted } from "@ehub/store/hosted";
import { createApi, passThrough } from "../src/app.ts";
import { parseAllowedEmails, sessionVerifier } from "../src/auth.ts";
import { createStoreRoutes } from "../src/store-routes.ts";
import { sessionToken } from "./helpers.ts";

const SECRET = "i".repeat(40);
let dir: string;
let app: ReturnType<typeof createApi>;
let A: Record<string, string>;
let B: Record<string, string>;

const NOTE_ID = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
const note = {
  id: NOTE_ID,
  item: { module: "library", id: "78w462eb", title: "T", href: "/library/book/78w462eb" },
  body: "segreto di A",
  pinned: false,
};
const json = { "content-type": "application/json" };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-iso-"));
  const roots = {
    library: path.join(dir, "library"),
    explore: path.join(dir, "explore"),
    notes: path.join(dir, "notes"),
    podcasts: path.join(dir, "podcasts"),
  };
  process.env.EHUB_NOTES_DATA_DIR = roots.notes;
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
  mountHosted(roots, new TursoDocClient(client as never), new MemoryBlobStore());
  app = createApi({
    corsOrigins: [],
    auth: { verify: sessionVerifier(SECRET), allowedEmails: parseAllowedEmails("") },
    modules: [createNotesApp({ access: passThrough }), createStoreRoutes(roots)],
  });
  A = { authorization: `Bearer ${await sessionToken(SECRET, { sub: "userA", email: "a@example.com" })}` };
  B = { authorization: `Bearer ${await sessionToken(SECRET, { sub: "userB", email: "b@example.com" })}` };
});
afterAll(async () => {
  unmountAll();
  delete process.env.EHUB_NOTES_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const list = async (headers: Record<string, string>) =>
  ((await (await app.request("/api/notes", { headers })).json()) as { notes: { body: string }[] }).notes;

describe("two users on the same API", () => {
  it("B does not see A's note in the list", async () => {
    expect((await app.request("/api/notes", { method: "POST", headers: { ...A, ...json }, body: JSON.stringify(note) })).status).toBe(201);
    expect((await list(A)).map((n) => n.body)).toEqual(["segreto di A"]);
    expect(await list(B)).toEqual([]);
  });

  it("B cannot edit or delete A's note by its id", async () => {
    const url = `/api/notes/library/78w462eb/${NOTE_ID}`;
    const patch = await app.request(url, { method: "PATCH", headers: { ...B, ...json }, body: JSON.stringify({ body: "hackerato" }) });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const del = await app.request(url, { method: "DELETE", headers: B });
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await list(A)).map((n) => n.body)).toEqual(["segreto di A"]);
  });

  it("B's note with the same ids is separate from A's", async () => {
    await app.request("/api/notes", { method: "POST", headers: { ...B, ...json }, body: JSON.stringify({ ...note, body: "nota di B" }) });
    expect((await list(B)).map((n) => n.body)).toEqual(["nota di B"]);
    expect((await list(A)).map((n) => n.body)).toEqual(["segreto di A"]);
    expect((await app.request(`/api/notes/library/78w462eb/${NOTE_ID}`, { method: "DELETE", headers: B })).status).toBeLessThan(300);
    expect((await list(A)).map((n) => n.body)).toEqual(["segreto di A"]);
    expect(await list(B)).toEqual([]);
  });

  it("the raw store routes (used by the CLIs) are per user too: by id and by listing", async () => {
    const key = "/api/store/notes/library/78w462eb.json";
    expect((await app.request(key, { headers: A })).status).toBe(200);
    expect((await app.request(key, { headers: B })).status).toBe(404);
    expect(await (await app.request("/api/store/notes?list=library", { headers: A })).json()).toEqual([{ name: "78w462eb.json", isDirectory: false }]);
    expect(await (await app.request("/api/store/notes?list=library", { headers: B })).json()).toEqual([]);
    expect((await app.request(key, { method: "DELETE", headers: B })).status).toBe(204);
    expect((await app.request(key, { headers: A })).status).toBe(200);
  });

  it("no request without a token reads or writes anything", async () => {
    for (const [method, url] of [
      ["GET", "/api/notes"],
      ["GET", "/api/store/notes/library/78w462eb.json"],
      ["GET", "/api/store/notes?list=library"],
      ["PUT", "/api/store/notes/library/78w462eb.json"],
      ["DELETE", "/api/store/notes/library/78w462eb.json"],
    ] as const) {
      expect((await app.request(url, { method })).status, `${method} ${url}`).toBe(401);
    }
  });
});
