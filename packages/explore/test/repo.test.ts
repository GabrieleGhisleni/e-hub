import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATA_DIR_ENV,
  ExploreError,
  addExploreBook,
  addJournal,
  addLibraryBook,
  addNote,
  checkExplorations,
  createExploration,
  listExplorations,
  readExploration,
  removeBook,
  removeNote,
  setVerdict,
  updateExploration,
  updateNote,
} from "../src/node/index.ts";
import { fakeLibrary, FAKE_EPUB } from "./fakes.ts";

let dir: string;
const AT = new Date(2026, 10, 12, 10, 0, 0);
const lib = () => fakeLibrary();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-explore-"));
  process.env[DATA_DIR_ENV] = dir;
});
afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  await rm(dir, { recursive: true, force: true });
});

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExploreError);
  expect((error as ExploreError).code).toBe(code);
  return error as ExploreError;
}

describe("create and read", () => {
  it("creates an exploration file with the date and the title slug as ID", async () => {
    const deps = lib();
    const created = await createExploration({ title: "Nietzsche e la morale", question: "Dove?" }, AT, deps);
    expect(created.id).toBe("2026-11-12-nietzsche-e-la-morale");
    expect(created).toMatchObject({ status: "open", summary: null, notes: [], journal: [], sources: [] });
    const onDisk = JSON.parse(await readFile(path.join(dir, `${created.id}.json`), "utf8"));
    expect(onDisk.title).toBe("Nietzsche e la morale");
    expect((await readExploration(created.id)).question).toBe("Dove?");
  });

  it("adds -2 and -3 when the ID is taken", async () => {
    const deps = lib();
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await createExploration({ title: "Stesso titolo", question: "Q" }, AT, deps)).id);
    }
    expect(ids).toEqual([
      "2026-11-12-stesso-titolo",
      "2026-11-12-stesso-titolo-2",
      "2026-11-12-stesso-titolo-3",
    ]);
  });

  it("creates with library books, and creates nothing when a book is unknown", async () => {
    const deps = lib();
    const created = await createExploration(
      { title: "Con libri", question: "Q", books: ["78w462eb", "78w462eb"] },
      AT,
      deps,
    );
    expect(created.sources.map((s) => s.id)).toEqual(["78w462eb"]);
    expect(created.sources[0]).toMatchObject({ origin: "library", title: "The Let Them Theory", language: "en" });
    await expectError(
      createExploration({ title: "Mancante", question: "Q", books: ["zzzzzzzz"] }, AT, deps),
      "not-found",
    );
    expect((await listExplorations()).map((e) => e.title)).toEqual(["Con libri"]);
  });

  it("refuses an empty title, an empty question and a malformed book ID", async () => {
    const deps = lib();
    await expectError(createExploration({ title: "  ", question: "Q" }, AT, deps), "invalid-input");
    await expectError(createExploration({ title: "T", question: "" }, AT, deps), "invalid-input");
    await expectError(createExploration({ title: "T", question: "Q", books: ["ABC"] }, AT, deps), "invalid-input");
  });

  it("reads a missing exploration as not-found, and a malformed ID as invalid-input", async () => {
    await expectError(readExploration("2026-11-12-assente"), "not-found");
    await expectError(readExploration("../etc/passwd"), "invalid-input");
  });

  it("updates title, question, summary and status; an empty summary is refused", async () => {
    const deps = lib();
    const e = await createExploration({ title: "Titolo", question: "Q" }, AT, deps);
    const updated = await updateExploration(e.id, { title: "Nuovo", summary: "Sintesi breve", status: "closed" });
    expect(updated).toMatchObject({ title: "Nuovo", summary: "Sintesi breve", status: "closed" });
    expect(updated.updatedAt >= e.updatedAt).toBe(true);
    expect((await updateExploration(e.id, { summary: null })).summary).toBeNull();
    await expectError(updateExploration(e.id, { summary: "   " }), "invalid-input");
  });
});

describe("sources", () => {
  it("adds a library book once", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const after = await addLibraryBook(e.id, "eec5cpre", deps);
    expect(after.sources).toHaveLength(1);
    await expectError(addLibraryBook(e.id, "eec5cpre", deps), "already-exists");
    await expectError(addLibraryBook(e.id, "zzzzzzzz", deps), "not-found");
  });

  it("imports an EPUB for exploring only (origin explore, epub record)", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const after = await addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "genealogia.epub" }, deps);
    const [source] = after.sources;
    expect(source).toMatchObject({ origin: "explore", title: "Genealogia della morale", language: "it" });
    expect(source!.epub).toMatchObject({ fileName: "genealogia.epub", bytes: FAKE_EPUB.byteLength });
    expect(source!.epub!.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(deps.imports).toHaveLength(1);
  });

  it("refuses the same EPUB twice in one exploration", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    await addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "a.epub" }, deps);
    await expectError(addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "b.epub" }, deps), "already-exists");
    expect(deps.imports).toHaveLength(1);
  });

  it("imports the text again when the same EPUB is re-added after the cache was cleared", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const added = await addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "a.epub" }, deps);
    const bookId = added.sources[0]!.id;
    await setVerdict(e.id, bookId, { decision: "skip", reason: "Fuori tema." }, "cli", AT);
    deps.clearCache();
    const after = await addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "a.epub" }, deps);
    expect(deps.imports).toEqual([bookId, bookId]);
    expect(after.sources).toHaveLength(1);
    expect(after.sources[0]!.verdict?.decision).toBe("skip");
  });

  it("reuses the book ID of the same EPUB in another exploration (one copy in the cache)", async () => {
    const deps = lib();
    const first = await createExploration({ title: "Prima", question: "Q" }, AT, deps);
    const second = await createExploration({ title: "Seconda", question: "Q" }, AT, deps);
    const a = await addExploreBook(first.id, { bytes: FAKE_EPUB, fileName: "g.epub" }, deps);
    const b = await addExploreBook(second.id, { bytes: FAKE_EPUB, fileName: "g.epub" }, deps);
    expect(b.sources[0]!.id).toBe(a.sources[0]!.id);
    expect(deps.imports).toEqual([a.sources[0]!.id]);
  });

  it("gives a new EPUB an ID unused by the explorations and the library", async () => {
    const deps = lib();
    const first = await createExploration({ title: "Prima", question: "Q" }, AT, deps);
    const other = new Uint8Array([1, 2, 3]);
    const a = await addExploreBook(first.id, { bytes: FAKE_EPUB, fileName: "a.epub" }, deps);
    const b = await addExploreBook(first.id, { bytes: other, fileName: "b.epub" }, deps);
    expect(a.sources[0]!.id).not.toBe(b.sources[1]!.id);
    expect(b.sources.map((s) => s.id)).toEqual([a.sources[0]!.id, b.sources[1]!.id]);
  });

  it("turns an import error into invalid-input and adds nothing", async () => {
    const deps = lib();
    deps.importExploreEpub = async () => {
      throw new Error("L'EPUB non contiene testo leggibile.");
    };
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const error = await expectError(addExploreBook(e.id, { bytes: FAKE_EPUB, fileName: "x.epub" }, deps), "invalid-input");
    expect(error.message).toContain("non contiene testo leggibile");
    expect((await readExploration(e.id)).sources).toEqual([]);
  });

  it("refuses an empty or oversized EPUB", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    await expectError(addExploreBook(e.id, { bytes: new Uint8Array(0), fileName: "x.epub" }, deps), "invalid-input");
  });

  it("removes a source with its verdict, and the book reference of its notes (the notes stay)", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q", books: ["78w462eb", "eec5cpre"] }, AT, deps);
    await setVerdict(e.id, "78w462eb", { decision: "all", reason: "Tutto." }, "cli", AT);
    await addNote(e.id, { body: "Su Robbins", book: "78w462eb" }, "app", AT);
    const after = await removeBook(e.id, "78w462eb", AT);
    expect(after.sources.map((s) => s.id)).toEqual(["eec5cpre"]);
    expect(after.notes).toHaveLength(1);
    expect(after.notes[0]!.book).toBeUndefined();
    await expectError(removeBook(e.id, "78w462eb"), "not-found");
  });
});

describe("verdicts", () => {
  it("sets a verdict and normalises the chapters", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q", books: ["78w462eb"] }, AT, deps);
    const after = await setVerdict(
      e.id,
      "78w462eb",
      { decision: "parts", chapters: [5, 2, 5], reason: "Solo il metodo." },
      "skill",
      AT,
    );
    expect(after.sources[0]!.verdict).toMatchObject({ decision: "parts", chapters: [2, 5], via: "skill" });
  });

  it("replaces an earlier verdict", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q", books: ["78w462eb"] }, AT, deps);
    await setVerdict(e.id, "78w462eb", { decision: "all", reason: "Prima." }, "cli", AT);
    const after = await setVerdict(e.id, "78w462eb", { decision: "skip", reason: "Dopo." }, "app", AT);
    expect(after.sources[0]!.verdict).toMatchObject({ decision: "skip", reason: "Dopo.", via: "app" });
  });

  it("refuses chapters on the wrong decision, parts without chapters, and an unknown source", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q", books: ["78w462eb"] }, AT, deps);
    await expectError(setVerdict(e.id, "78w462eb", { decision: "all", chapters: [1], reason: "x" }, "cli"), "invalid-input");
    await expectError(setVerdict(e.id, "78w462eb", { decision: "parts", reason: "x" }, "cli"), "invalid-input");
    await expectError(setVerdict(e.id, "78w462eb", { decision: "parts", chapters: [0], reason: "x" }, "cli"), "invalid-input");
    await expectError(setVerdict(e.id, "eec5cpre", { decision: "all", reason: "x" }, "cli"), "not-found");
    await expectError(setVerdict(e.id, "78w462eb", { decision: "all", reason: "a\nb" }, "cli"), "invalid-input");
    expect((await readExploration(e.id)).sources[0]!.verdict).toBeNull();
  });
});

describe("notes and journal", () => {
  it("adds, edits and removes notes; a note on a non-source is refused", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q", books: ["78w462eb"] }, AT, deps);
    const id = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
    const withNote = await addNote(e.id, { id, body: "  Prima  ", book: "78w462eb" }, "app", AT);
    expect(withNote.notes[0]).toMatchObject({ id, body: "Prima", book: "78w462eb", via: "app" });
    await expectError(addNote(e.id, { id, body: "Doppia" }, "cli", AT), "already-exists");
    await expectError(addNote(e.id, { body: "Altro", book: "eec5cpre" }, "cli", AT), "invalid-input");
    await expectError(addNote(e.id, { body: "   " }, "cli", AT), "invalid-input");

    const edited = await updateNote(e.id, id, "Modificata", AT);
    expect(edited.notes[0]!.body).toBe("Modificata");
    await expectError(updateNote(e.id, "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "x"), "not-found");

    const removed = await removeNote(e.id, id, AT);
    expect(removed.notes).toEqual([]);
    await expectError(removeNote(e.id, id), "not-found");
  });

  it("appends journal entries with the via and the text", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const after = await addJournal(e.id, "  Emerso il tema.  ", "skill", AT);
    expect(after.journal).toEqual([{ at: AT.toISOString(), via: "skill", text: "Emerso il tema." }]);
    await expectError(addJournal(e.id, "", "cli", AT), "invalid-input");
  });
});

describe("concurrency and files on disk", () => {
  it("does not lose any of concurrent writes to one exploration", async () => {
    const deps = lib();
    const e = await createExploration({ title: "T", question: "Q" }, AT, deps);
    const writes = Array.from({ length: 20 }, (_, i) => addJournal(e.id, `voce ${i}`, "cli"));
    await Promise.all(writes);
    await Promise.all(Array.from({ length: 10 }, (_, i) => addNote(e.id, { body: `nota ${i}` }, "app")));
    const final = await readExploration(e.id);
    expect(final.journal).toHaveLength(20);
    expect(final.notes).toHaveLength(10);
    expect(new Set(final.journal.map((j) => j.text)).size).toBe(20);
  });

  it("lists newest first and reports invalid files instead of skipping them", async () => {
    const deps = lib();
    await createExploration({ title: "Vecchia", question: "Q" }, new Date(2026, 0, 1), deps);
    await createExploration({ title: "Nuova", question: "Q" }, new Date(2026, 5, 1), deps);
    expect((await listExplorations()).map((e) => e.title)).toEqual(["Nuova", "Vecchia"]);

    await writeFile(path.join(dir, "2026-01-01-rotta.json"), '{"version": 1}');
    await expectError(listExplorations().then(() => undefined), "invalid-file");
    const check = await checkExplorations();
    expect(check.valid).toBe(2);
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]!.details.length).toBeGreaterThan(0);
  });

  it("refuses a file whose name does not match its ID", async () => {
    const deps = lib();
    const e = await createExploration({ title: "Nome", question: "Q" }, AT, deps);
    const content = await readFile(path.join(dir, `${e.id}.json`), "utf8");
    await writeFile(path.join(dir, "2026-11-12-altro.json"), content);
    const check = await checkExplorations();
    expect(check.problems.map((p) => p.message)).toContain("Il nome del file non corrisponde all'ID: 2026-11-12-altro.json");
  });
});
