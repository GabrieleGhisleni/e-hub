import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BookNotFoundError,
  InvalidBookIdError,
  InvalidDataError,
  bookDir,
  coverPath,
  deleteBookDir,
  listBookIds,
  notesPath,
  readAllBooks,
  readBook,
  readBookMarkdown,
  readTopics,
  recallPath,
  serializeBook,
  studyPath,
  writeBook,
  writeTopics,
} from "../../src/node/repo/index.ts";
import type { Book } from "../../src/shared/schema.ts";
import { type TempDataDir, makeTempDataDir } from "../helpers/data-dir.ts";

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

const book = (id: string, extra: Partial<Book> = {}): Book => ({
  id,
  title: "Sapiens",
  authors: ["Yuval Noah Harari"],
  topic: "saggistica",
  status: "reading",
  ...extra,
});

describe("topics", () => {
  it("reads the fixture and round-trips it", async () => {
    const topics = await readTopics(tmp.dataDir);
    expect(topics.map((t) => t.id)).toEqual([
      "unsorted",
      "narrativa",
      "saggistica",
      "filosofia",
      "scienze-sociali",
    ]);
    const before = await readFile(path.join(tmp.dataDir, "topics.json"), "utf8");
    await writeTopics(tmp.dataDir, topics);
    expect(await readFile(path.join(tmp.dataDir, "topics.json"), "utf8")).toBe(before);
  });

  it("refuses to write an invalid list", async () => {
    await expect(
      writeTopics(tmp.dataDir, [{ id: "storia", label: "Storia" }]),
    ).rejects.toBeInstanceOf(InvalidDataError);
  });

  it("reports invalid topics.json", async () => {
    await writeFile(path.join(tmp.dataDir, "topics.json"), "[{");
    await expect(readTopics(tmp.dataDir)).rejects.toBeInstanceOf(InvalidDataError);
  });
});

describe("books", () => {
  it("round-trips a book", async () => {
    const b = book("7k2m9q4t", { tags: ["storia"], rating: 4 });
    await writeBook(tmp.dataDir, b);
    expect(await readBook(tmp.dataDir, "7k2m9q4t")).toEqual(b);
  });

  it("writes canonical key order, unknown keys after in original order, 2 spaces + newline", async () => {
    const messy = {
      zeta: 1,
      status: "read",
      title: "Sapiens",
      alpha: { nested: true },
      rating: 5,
      authors: ["Yuval Noah Harari"],
      id: "7k2m9q4t",
      topic: "saggistica",
      tags: ["storia"],
      mine: "x",
    } as Book;
    await writeBook(tmp.dataDir, messy);
    const text = await readFile(path.join(tmp.dataDir, "books/7k2m9q4t/book.json"), "utf8");
    expect(Object.keys(JSON.parse(text))).toEqual([
      "id",
      "title",
      "authors",
      "topic",
      "status",
      "tags",
      "rating",
      "zeta",
      "alpha",
      "mine",
    ]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "title": "Sapiens",\n');
    expect(serializeBook(messy)).toBe(text);
  });

  it("preserves unknown fields through read + write", async () => {
    const dir = path.join(tmp.dataDir, "books/7k2m9q4t");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "book.json"),
      JSON.stringify({ ...book("7k2m9q4t"), handAdded: { keep: "me" } }),
    );
    const read = await readBook(tmp.dataDir, "7k2m9q4t");
    await writeBook(tmp.dataDir, { ...read, status: "read" });
    const again = await readBook(tmp.dataDir, "7k2m9q4t");
    expect(again).toMatchObject({ status: "read", handAdded: { keep: "me" } });
  });

  it("writes atomically (no temp files left) and validates", async () => {
    await writeBook(tmp.dataDir, book("7k2m9q4t"));
    expect(await readdir(path.join(tmp.dataDir, "books/7k2m9q4t"))).toEqual(["book.json"]);
    await expect(
      writeBook(tmp.dataDir, book("7k2m9q4t", { status: "nope" as never })),
    ).rejects.toBeInstanceOf(InvalidDataError);
    await expect(writeBook(tmp.dataDir, book("../evil"))).rejects.toBeInstanceOf(
      InvalidBookIdError,
    );
  });

  it("readAllBooks skips incomplete folders and reports invalid ones", async () => {
    await writeBook(tmp.dataDir, book("bbbbbbbb"));
    await writeBook(tmp.dataDir, book("aaaaaaaa"));
    await mkdir(path.join(tmp.dataDir, "books/cccccccc"), { recursive: true }); // incomplete upload
    await mkdir(path.join(tmp.dataDir, "books/dddddddd"), { recursive: true });
    await writeFile(path.join(tmp.dataDir, "books/dddddddd/book.json"), '{"id":"dddddddd"}');
    await mkdir(path.join(tmp.dataDir, "books/eeeeeeee"), { recursive: true });
    await writeFile(
      path.join(tmp.dataDir, "books/eeeeeeee/book.json"),
      JSON.stringify(book("ffffffff")),
    );
    await mkdir(path.join(tmp.dataDir, "books/not-an-id"), { recursive: true });
    await writeFile(path.join(tmp.dataDir, "books/.gitkeep"), "");

    const { books, incomplete, invalid } = await readAllBooks(tmp.dataDir);
    expect(books.map((b) => b.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(incomplete).toEqual(["cccccccc"]);
    expect(invalid.map((i) => i.id)).toEqual(["dddddddd", "eeeeeeee", "not-an-id"]);
    expect(invalid[1]?.message).toMatch(/does not match its folder/);

    // ID uniqueness must still see every folder, incomplete included.
    expect(await listBookIds(tmp.dataDir)).toEqual([
      "aaaaaaaa",
      "bbbbbbbb",
      "cccccccc",
      "dddddddd",
      "eeeeeeee",
      "not-an-id",
    ]);
    await expect(readBook(tmp.dataDir, "cccccccc")).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it("listBookIds is empty when data/books is missing", async () => {
    expect(await listBookIds(path.join(tmp.root, "nowhere"))).toEqual([]);
  });

  it("knows the side files and deletes the whole folder", async () => {
    await writeBook(tmp.dataDir, book("7k2m9q4t"));
    const dir = bookDir(tmp.dataDir, "7k2m9q4t");
    expect(coverPath(tmp.dataDir, "7k2m9q4t")).toBe(path.join(dir, "cover.webp"));
    expect(recallPath(tmp.dataDir, "7k2m9q4t")).toBe(path.join(dir, "recall.md"));
    expect(studyPath(tmp.dataDir, "7k2m9q4t")).toBe(path.join(dir, "study.md"));
    await writeFile(notesPath(tmp.dataDir, "7k2m9q4t"), "# Appunti\n");
    expect(await readBookMarkdown(tmp.dataDir, "7k2m9q4t", "notes")).toBe("# Appunti\n");
    expect(await readBookMarkdown(tmp.dataDir, "7k2m9q4t", "recall")).toBeNull();

    await deleteBookDir(tmp.dataDir, "7k2m9q4t");
    expect(await listBookIds(tmp.dataDir)).toEqual([]);
    await deleteBookDir(tmp.dataDir, "7k2m9q4t"); // no-op
    expect(() => bookDir(tmp.dataDir, "..")).toThrow(InvalidBookIdError);
  });
});
