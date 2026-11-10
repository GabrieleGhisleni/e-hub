import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR_ENV } from "../node/repo";
import { createNotesApp } from "./app";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-notes-"));
  process.env[DATA_DIR_ENV] = dir;
});
afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  await rm(dir, { recursive: true, force: true });
});

const HOST = "127.0.0.1:5173";
const item = {
  module: "library",
  id: "78w462eb",
  title: "The Let Them Theory",
  subtitle: "Mel Robbins",
  href: "/library/book/78w462eb/robbins-the-let-them-theory",
};
const ID_1 = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
const ID_2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function call(
  app: ReturnType<typeof createNotesApp>,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(url, {
    method,
    headers: {
      host: HOST,
      ...(body !== undefined
        ? { "content-type": "application/json", origin: `http://${HOST}` }
        : {}),
      ...(method === "DELETE" ? { origin: `http://${HOST}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("notes API", () => {
  it("creates, lists, pins, edits and deletes notes, one file per item", async () => {
    const app = createNotesApp();
    const created = await call(app, "POST", "/api/notes", { id: ID_1, item, body: "  Prima  " });
    expect(created.status).toBe(201);
    const note = (await created.json()) as { createdAt: string; updatedAt: string; body: string };
    expect(note.body).toBe("Prima");

    await call(app, "POST", "/api/notes", { id: ID_2, item, body: "Seconda", pinned: true });
    const file = JSON.parse(await readFile(path.join(dir, "library", "78w462eb.json"), "utf8"));
    expect(file.item).toEqual(item);
    expect(file.notes.map((n: { body: string }) => n.body)).toEqual(["Prima", "Seconda"]);

    const listed = (await (await call(app, "GET", "/api/notes")).json()) as { notes: unknown[] };
    expect(listed.notes).toHaveLength(2);

    const pinned = await call(app, "PATCH", `/api/notes/library/78w462eb/${ID_1}`, {
      pinned: true,
    });
    expect(await pinned.json()).toMatchObject({ pinned: true, updatedAt: note.updatedAt });

    const edited = await call(app, "PATCH", `/api/notes/library/78w462eb/${ID_1}`, {
      body: "Modificata",
      expectedUpdatedAt: note.updatedAt,
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { updatedAt: string }).updatedAt).not.toBe(note.updatedAt);

    // A stale edit is refused.
    const stale = await call(app, "PATCH", `/api/notes/library/78w462eb/${ID_1}`, {
      body: "Vecchia",
      expectedUpdatedAt: note.updatedAt,
    });
    expect(stale.status).toBe(409);

    expect((await call(app, "DELETE", `/api/notes/library/78w462eb/${ID_1}`)).status).toBe(200);
    expect((await call(app, "DELETE", `/api/notes/library/78w462eb/${ID_2}`)).status).toBe(200);
    // The last note gone, the file goes too.
    expect(await readdir(path.join(dir, "library"))).toEqual([]);
    expect((await call(app, "DELETE", `/api/notes/library/78w462eb/${ID_2}`)).status).toBe(404);
  });

  it("refuses duplicate IDs, bad items and empty notes", async () => {
    const app = createNotesApp();
    await call(app, "POST", "/api/notes", { id: ID_1, item, body: "x" });
    expect((await call(app, "POST", "/api/notes", { id: ID_1, item, body: "y" })).status).toBe(409);
    for (const bad of [
      { id: ID_2, item: { ...item, href: "javascript:alert(1)" }, body: "x" },
      { id: ID_2, item: { ...item, href: "/podcasts/episode/x/" }, body: "x" },
      { id: ID_2, item: { ...item, id: "../etc/passwd" }, body: "x" },
      { id: "not-a-uuid", item, body: "x" },
      { id: ID_2, item, body: "   " },
      { id: ID_2, item, body: "x", extra: true },
    ]) {
      expect((await call(app, "POST", "/api/notes", bad)).status).toBe(400);
    }
    expect(
      (await call(app, "PATCH", `/api/notes/library/..%2Fx/${ID_1}`, { pinned: true })).status,
    ).toBe(400);
  });

  it("accepts requests only from the app on localhost", async () => {
    const app = createNotesApp();
    expect((await call(app, "GET", "/api/notes", undefined, { host: "evil.example" })).status).toBe(
      403,
    );
    const body = { id: ID_1, item, body: "x" };
    expect(
      (await call(app, "POST", "/api/notes", body, { origin: "http://evil.example" })).status,
    ).toBe(403);
    expect(
      (await call(app, "POST", "/api/notes", body, { origin: "http://127.0.0.1:9999" })).status,
    ).toBe(403);
    expect(
      (await call(app, "POST", "/api/notes", body, { "content-type": "text/plain" })).status,
    ).toBe(415);
    expect(
      (await call(app, "DELETE", `/api/notes/library/78w462eb/${ID_1}`, undefined, { origin: "" }))
        .status,
    ).toBe(403);
  });

  it("runs the guard on new text and reports its reasons", async () => {
    const app = createNotesApp({
      guard: async (target, body) =>
        target.module === "library" && body.includes("copied") ? ["«copied…»"] : [],
    });
    const refused = await call(app, "POST", "/api/notes", { id: ID_1, item, body: "copied text" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      code: "transcript-guard",
      details: ["«copied…»"],
    });
    await call(app, "POST", "/api/notes", { id: ID_1, item, body: "mine" });
    const edit = await call(app, "PATCH", `/api/notes/library/78w462eb/${ID_1}`, {
      body: "copied again",
    });
    expect(edit.status).toBe(422);
  });

  it("fails loudly on an invalid notes file instead of dropping it", async () => {
    await mkdir(path.join(dir, "library"), { recursive: true });
    await writeFile(path.join(dir, "library", "broken.json"), '{"item": 1}');
    const response = await call(createNotesApp(), "GET", "/api/notes");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "invalid-file" });
  });
});
