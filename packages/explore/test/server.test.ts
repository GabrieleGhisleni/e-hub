import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR_ENV } from "../src/node/index.ts";
import { createExploreApp } from "../src/server/app.ts";
import { FAKE_EPUB, fakeLibrary } from "./fakes.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-explore-api-"));
  process.env[DATA_DIR_ENV] = dir;
});
afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  await rm(dir, { recursive: true, force: true });
});

const HOST = "127.0.0.1:5173";
const ORIGIN = `http://${HOST}`;
const NOTE_ID = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
const UNKNOWN_NOTE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function setup() {
  const deps = fakeLibrary();
  return { app: createExploreApp({ deps }), deps };
}

type App = ReturnType<typeof createExploreApp>;

/** Parsed JSON of a response (typed loosely: the tests check the fields they name). */
// biome-ignore lint/suspicious/noExplicitAny: test helper
async function body(response: Response): Promise<any> {
  return response.json();
}

/** A request from the app itself: loopback host, JSON body and same-origin `Origin` for writes. */
function call(app: App, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(url, {
    method,
    headers: {
      host: HOST,
      ...(body !== undefined ? { "content-type": "application/json", origin: ORIGIN } : {}),
      ...(method === "DELETE" ? { origin: ORIGIN } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function create(app: App, title = "Prova", books?: string[]) {
  const response = await call(app, "POST", "/api/explore", {
    title,
    question: "Domanda?",
    ...(books ? { books } : {}),
  });
  expect(response.status).toBe(201);
  return (await body(response)) as { id: string; sources: { id: string }[]; notes: { id: string }[] };
}

describe("explore API: reads", () => {
  it("lists explorations, library books and one exploration; a missing one is 404", async () => {
    const { app } = setup();
    expect(await (await call(app, "GET", "/api/explore")).json()).toEqual({ explorations: [] });
    const created = await create(app, "Prova", ["78w462eb"]);
    const listed = (await (await call(app, "GET", "/api/explore")).json()) as { explorations: unknown[] };
    expect(listed.explorations).toHaveLength(1);

    const books: { books: { id: string }[] } = await body(await call(app, "GET", "/api/explore/library-books"));
    expect(books.books.map((b) => b.id).sort()).toEqual(["78w462eb", "eec5cpre"]);

    const one = await call(app, "GET", `/api/explore/${created.id}`);
    expect(one.status).toBe(200);
    expect(await body(one)).toMatchObject({ id: created.id, question: "Domanda?" });

    expect((await call(app, "GET", "/api/explore/2026-11-12-assente")).status).toBe(404);
    expect((await call(app, "GET", "/api/explore/..%2Fsegreto")).status).toBe(400);
    expect((await call(app, "GET", "/api/altro")).status).toBe(404);
  });
});

describe("explore API: writes", () => {
  it("creates, patches, adds and removes sources, sets verdicts, notes and journal, all via app", async () => {
    const { app } = setup();
    const created = await create(app, "Prova", ["78w462eb"]);
    const id = created.id;

    const patched = await call(app, "PATCH", `/api/explore/${id}`, { title: "Nuovo titolo", status: "closed" });
    expect(patched.status).toBe(200);
    expect(await body(patched)).toMatchObject({ title: "Nuovo titolo", status: "closed" });

    const summary = await call(app, "PATCH", `/api/explore/${id}`, { summary: "Sintesi." });
    expect(await body(summary)).toMatchObject({ summary: "Sintesi." });

    const added = await call(app, "POST", `/api/explore/${id}/books`, { bookId: "eec5cpre" });
    expect(added.status).toBe(201);
    expect((await body(added)).sources).toHaveLength(2);
    expect((await call(app, "POST", `/api/explore/${id}/books`, { bookId: "eec5cpre" })).status).toBe(409);

    const verdict = await call(app, "PUT", `/api/explore/${id}/verdicts/78w462eb`, {
      decision: "parts",
      chapters: [5, 2],
      reason: "Il metodo.",
    });
    expect(verdict.status).toBe(200);
    const verdicted = await body(verdict);
    expect(verdicted.sources[0].verdict).toMatchObject({ decision: "parts", chapters: [2, 5], via: "app" });

    const note = await call(app, "POST", `/api/explore/${id}/notes`, { id: NOTE_ID, body: "Nota", book: "78w462eb" });
    expect(note.status).toBe(201);
    expect((await body(note)).notes[0]).toMatchObject({ id: NOTE_ID, via: "app" });

    const edited = await call(app, "PATCH", `/api/explore/${id}/notes/${NOTE_ID}`, { body: "Nota modificata" });
    expect(edited.status).toBe(200);
    expect((await body(edited)).notes[0].body).toBe("Nota modificata");

    const journal = await call(app, "POST", `/api/explore/${id}/journal`, { text: "Emerso il tema." });
    expect(journal.status).toBe(201);
    expect((await body(journal)).journal[0]).toMatchObject({ via: "app", text: "Emerso il tema." });

    const removedNote = await call(app, "DELETE", `/api/explore/${id}/notes/${NOTE_ID}`);
    expect(removedNote.status).toBe(200);
    expect((await body(removedNote)).notes).toEqual([]);

    const removedBook = await call(app, "DELETE", `/api/explore/${id}/books/eec5cpre`);
    expect(removedBook.status).toBe(200);
    expect((await body(removedBook)).sources.map((s: { id: string }) => s.id)).toEqual(["78w462eb"]);
  });

  it("answers 404 for unknown explorations, notes and sources, and 422 for a note on a non-source", async () => {
    const { app } = setup();
    const created = await create(app);
    const id = created.id;
    expect((await call(app, "PATCH", `/api/explore/2026-11-12-assente`, { title: "x" })).status).toBe(404);
    expect((await call(app, "PATCH", `/api/explore/${id}/notes/${UNKNOWN_NOTE}`, { body: "x" })).status).toBe(404);
    expect((await call(app, "DELETE", `/api/explore/${id}/notes/${UNKNOWN_NOTE}`)).status).toBe(404);
    expect((await call(app, "DELETE", `/api/explore/${id}/books/eec5cpre`)).status).toBe(404);
    expect((await call(app, "PUT", `/api/explore/${id}/verdicts/eec5cpre`, { decision: "all", reason: "x" })).status).toBe(404);
    const onNonSource = await call(app, "POST", `/api/explore/${id}/notes`, { body: "x", book: "eec5cpre" });
    expect(onNonSource.status).toBe(422);
    expect(await body(onNonSource)).toMatchObject({ code: "invalid-input" });
    expect((await call(app, "POST", "/api/explore", { title: "x", question: "Q", books: ["zzzzzzzz"] })).status).toBe(404);
  });

  it("rejects bad bodies with 400 and the reasons", async () => {
    const { app } = setup();
    const created = await create(app);
    const bad = [
      ["POST", "/api/explore", { title: "", question: "Q" }],
      ["POST", "/api/explore", { title: "T", question: "Q", extra: true }],
      ["PATCH", `/api/explore/${created.id}`, {}],
      ["POST", `/api/explore/${created.id}/notes`, { body: "   " }],
      ["POST", `/api/explore/${created.id}/journal`, { text: "" }],
    ] as const;
    for (const [method, url, payload] of bad) {
      const response = await call(app, method, url, payload);
      expect(response.status, `${method} ${url}`).toBe(400);
    }
    // Parts without chapters is a rule of the domain, not of the shape: 422.
    const noChapters = await call(app, "PUT", `/api/explore/${created.id}/verdicts/78w462eb`, {
      decision: "parts",
      reason: "x",
    });
    expect(noChapters.status).toBe(422);
    const invalidJson = await app.request(`/api/explore/${created.id}/journal`, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json", origin: ORIGIN },
      body: "{non json",
    });
    expect(invalidJson.status).toBe(400);
  });

  it("refuses an oversized JSON body with 413", async () => {
    const { app } = setup();
    const created = await create(app);
    const response = await call(app, "POST", `/api/explore/${created.id}/journal`, {
      text: "x".repeat(300 * 1024),
    });
    expect(response.status).toBe(413);
  });
});

describe("explore API: EPUB upload", () => {
  it("imports an EPUB for exploring only, from the raw body and the file name header", async () => {
    const { app, deps } = setup();
    const created = await create(app);
    const response = await app.request(`/api/explore/${created.id}/epub`, {
      method: "POST",
      headers: {
        host: HOST,
        origin: ORIGIN,
        "content-type": "application/epub+zip",
        "x-file-name": encodeURIComponent("Genealogia della morale.epub"),
      },
      body: FAKE_EPUB,
    });
    expect(response.status).toBe(201);
    const imported = await body(response);
    expect(imported.sources[0]).toMatchObject({
      origin: "explore",
      title: "Genealogia della morale",
      epub: { fileName: "Genealogia della morale.epub", bytes: FAKE_EPUB.byteLength },
    });
    expect(deps.imports).toHaveLength(1);
  });

  it("refuses the upload with the wrong type, without the file name, and with a path as file name", async () => {
    const { app } = setup();
    const created = await create(app);
    const wrongType = await app.request(`/api/explore/${created.id}/epub`, {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", "x-file-name": "a.epub" },
      body: FAKE_EPUB,
    });
    expect(wrongType.status).toBe(415);
    const noName = await app.request(`/api/explore/${created.id}/epub`, {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/epub+zip" },
      body: FAKE_EPUB,
    });
    expect(noName.status).toBe(400);
    const pathName = await app.request(`/api/explore/${created.id}/epub`, {
      method: "POST",
      headers: {
        host: HOST,
        origin: ORIGIN,
        "content-type": "application/epub+zip",
        "x-file-name": encodeURIComponent("../../etc/evil.epub"),
      },
      body: FAKE_EPUB,
    });
    expect(pathName.status).toBe(201);
    expect((await body(pathName)).sources[0].epub.fileName).toBe("evil.epub");
  });
});

describe("explore API: local only", () => {
  it("refuses other hosts, other origins and non-JSON writes", async () => {
    const { app } = setup();
    expect((await call(app, "GET", "/api/explore", undefined, { host: "evil.example" })).status).toBe(403);
    const body = { title: "T", question: "Q" };
    expect((await call(app, "POST", "/api/explore", body, { origin: "http://evil.example" })).status).toBe(403);
    expect((await call(app, "POST", "/api/explore", body, { origin: "http://127.0.0.1:9999" })).status).toBe(403);
    expect((await call(app, "POST", "/api/explore", body, { "content-type": "text/plain" })).status).toBe(415);
    expect((await call(app, "DELETE", "/api/explore/2026-11-12-x/books/78w462eb", undefined, { origin: "" })).status).toBe(403);
    expect(await readdir(dir)).toEqual([]);
  });

  it("accepts the loopback names (localhost, ::1) and nothing else", async () => {
    const { app } = setup();
    expect((await call(app, "GET", "/api/explore", undefined, { host: "localhost:5173" })).status).toBe(200);
    expect((await call(app, "GET", "/api/explore", undefined, { host: "[::1]:5173" })).status).toBe(200);
    expect((await call(app, "GET", "/api/explore", undefined, { host: "localhost.evil.example" })).status).toBe(403);
  });

  it("fails loudly on an invalid file instead of dropping it", async () => {
    const { app } = setup();
    await writeFile(path.join(dir, "2026-01-01-rotta.json"), '{"version": 1}');
    const response = await call(app, "GET", "/api/explore");
    expect(response.status).toBe(500);
    expect(await body(response)).toMatchObject({ code: "invalid-file" });
  });
});

describe("explore API: notebook", () => {
  it("sets, appends to and clears the notebook, all via app", async () => {
    const { app } = setup();
    const id = (await create(app)).id;

    const set = await call(app, "PUT", `/api/explore/${id}/notebook`, { body: "# Quaderno" });
    expect(set.status).toBe(200);
    expect((await body(set)).notebook).toMatchObject({ body: "# Quaderno", via: "app" });

    const appended = await call(app, "POST", `/api/explore/${id}/notebook/append`, { text: "Altro" });
    expect(appended.status).toBe(200);
    expect((await body(appended)).notebook.body).toBe("# Quaderno\n\nAltro");

    const cleared = await call(app, "PUT", `/api/explore/${id}/notebook`, { body: "" });
    expect(cleared.status).toBe(200);
    expect((await body(cleared)).notebook).toBeUndefined();
  });

  it("rejects bad notebook bodies with 400 (shape, length) and 422 (empty append)", async () => {
    const { app } = setup();
    const id = (await create(app)).id;
    expect((await call(app, "PUT", `/api/explore/${id}/notebook`, { text: "x" })).status).toBe(400);
    expect((await call(app, "PUT", `/api/explore/${id}/notebook`, { body: 42 })).status).toBe(400);
    expect(
      (await call(app, "PUT", `/api/explore/${id}/notebook`, { body: "x".repeat(100_001) })).status,
    ).toBe(400);
    expect((await call(app, "POST", `/api/explore/${id}/notebook/append`, { text: "   " })).status).toBe(422);
    expect((await call(app, "PUT", `/api/explore/2026-11-12-assente/notebook`, { body: "x" })).status).toBe(404);
  });

  it("accepts a notebook of 100k characters in several bytes each (over the 256 KB JSON limit)", async () => {
    const { app } = setup();
    const id = (await create(app)).id;
    const response = await call(app, "PUT", `/api/explore/${id}/notebook`, { body: "è".repeat(100_000) });
    expect(response.status).toBe(200);
    expect((await body(response)).notebook.body.length).toBe(100_000);
  });

  it("refuses a notebook body over 1 MB with 413", async () => {
    const { app } = setup();
    const id = (await create(app)).id;
    const response = await call(app, "PUT", `/api/explore/${id}/notebook`, { body: "x".repeat(1024 * 1024 + 10) });
    expect(response.status).toBe(413);
  });
});

describe("explore API: summaries", () => {
  async function upload(app: App, id: string, fileName = "Genealogia della morale.epub") {
    return app.request(`/api/explore/${id}/epub`, {
      method: "POST",
      headers: {
        host: HOST,
        origin: ORIGIN,
        "content-type": "application/epub+zip",
        "x-file-name": encodeURIComponent(fileName),
      },
      body: FAKE_EPUB,
    });
  }

  it("starts the summary of the new explore book in the background after an EPUB upload", async () => {
    const deps = fakeLibrary();
    const app = createExploreApp({ deps });
    const id = (await create(app)).id;
    const response = await upload(app, id);
    expect(response.status).toBe(201);
    const exploreId = (await body(response)).sources[0].id;
    expect(deps.summaryStarts).toEqual([{ id: exploreId, force: false }]);
  });

  it("does not start a summary for a library book added to the exploration", async () => {
    const deps = fakeLibrary();
    const app = createExploreApp({ deps });
    const id = (await create(app)).id;
    expect((await call(app, "POST", `/api/explore/${id}/books`, { bookId: "78w462eb" })).status).toBe(201);
    expect(deps.summaryStarts).toEqual([]);
  });

  it("reports the status of every source: library books done or none, explore books their run", async () => {
    const deps = fakeLibrary({ librarySummaries: ["78w462eb"] });
    const app = createExploreApp({ deps });
    const id = (await create(app, "Prova", ["78w462eb", "eec5cpre"])).id;
    const exploreId = (await body(await upload(app, id))).sources.find(
      (s: { origin: string }) => s.origin === "explore",
    ).id;
    deps.summaryStates.set(exploreId, { state: "running", done: 2, total: 5 });

    const response = await call(app, "GET", `/api/explore/${id}/summaries`);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      books: [
        { bookId: "78w462eb", origin: "library", state: "done" },
        { bookId: "eec5cpre", origin: "library", state: "none" },
        { bookId: exploreId, origin: "explore", state: "running", done: 2, total: 5 },
      ],
    });

    deps.summaryStates.set(exploreId, { state: "failed", error: "Il modello non risponde." });
    const failed = await body(await call(app, "GET", `/api/explore/${id}/summaries`));
    expect(failed.books[2]).toEqual({
      bookId: exploreId,
      origin: "explore",
      state: "failed",
      error: "Il modello non risponde.",
    });
  });

  it("answers 404 for the status of a missing exploration", async () => {
    const { app } = setup();
    expect((await call(app, "GET", "/api/explore/2026-11-12-assente/summaries")).status).toBe(404);
  });

  it("restarts the summary of an explore book with force and answers 202", async () => {
    const deps = fakeLibrary();
    const app = createExploreApp({ deps });
    const id = (await create(app)).id;
    const exploreId = (await body(await upload(app, id))).sources[0].id;
    deps.summaryStarts.length = 0;

    const response = await call(app, "POST", `/api/explore/${id}/books/${exploreId}/summary`, {});
    expect(response.status).toBe(202);
    expect(await body(response)).toEqual({ state: "running" });
    expect(deps.summaryStarts).toEqual([{ id: exploreId, force: true }]);
  });

  it("refuses the retry for a library book (400), a book not in the exploration (404) and a missing exploration", async () => {
    const deps = fakeLibrary();
    const app = createExploreApp({ deps });
    const id = (await create(app, "Prova", ["78w462eb"])).id;
    const library = await call(app, "POST", `/api/explore/${id}/books/78w462eb/summary`, {});
    expect(library.status).toBe(400);
    expect(await body(library)).toMatchObject({ code: "bad-request" });
    expect((await call(app, "POST", `/api/explore/${id}/books/eec5cpre/summary`, {})).status).toBe(404);
    expect((await call(app, "POST", "/api/explore/2026-11-12-assente/books/78w462eb/summary", {})).status).toBe(404);
    expect(deps.summaryStarts).toEqual([]);
  });
});
