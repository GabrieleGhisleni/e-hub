import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBookMarkdown, writeBook } from "../../../src/node/repo/index.ts";
import { ServiceError, saveBookNotes } from "../../../src/node/services/index.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { type ServicesTestEnv, setupServices } from "./setup.ts";

const ID = "fx000001";
const BOOK = {
  id: ID,
  title: "Libro",
  authors: ["A. Autore"],
  topic: "narrativa",
  status: "to-read",
  tags: [],
  addedAt: "2026-11-01",
} as unknown as Book;

describe("saveBookNotes", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
    await writeBook(t.env.dataDir, BOOK).catch(() => undefined);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("writes notes.md, skips an unchanged text and removes the file when emptied", async () => {
    expect(await saveBookNotes(t.ctx, ID, { notes: "# Idee\nUno." })).toEqual({ written: true });
    expect(await readBookMarkdown(t.env.dataDir, ID, "notes")).toBe("# Idee\nUno.\n");
    expect(await saveBookNotes(t.ctx, ID, { notes: "# Idee\nUno." })).toEqual({ written: false });
    expect(await saveBookNotes(t.ctx, ID, { notes: "" })).toEqual({ written: true });
    expect(await readBookMarkdown(t.env.dataDir, ID, "notes")).toBeNull();
  });

  it("refuses an unknown book", async () => {
    await expect(saveBookNotes(t.ctx, "zzzzzzzz", { notes: "x" })).rejects.toBeInstanceOf(ServiceError);
  });
});
