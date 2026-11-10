import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateData } from "../../../src/node/site-data/index.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/index.ts";
import { writeFakeBook } from "./fixtures.ts";

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(() => tmp.cleanup());

const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join("\n");

describe("validateData", () => {
  it("passes on a clean data dir", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" }, { "cover.webp": "x", "notes.md": "n" });
    expect(await validateData(tmp.dataDir)).toEqual({ errors: [], warnings: [] });
  });

  it.each(["book.epub", "text.md", "highlights.json", "book.kepub.epub"])(
    "rejects %s inside a book folder",
    async (name) => {
      await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" }, { [name]: "x" });
      const { errors } = await validateData(tmp.dataDir);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.path).toBe(`books/aaaaaaaa/${name}`);
    },
  );

  it("rejects stray files and directories elsewhere in data/", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    await mkdir(path.join(tmp.dataDir, "books", "aaaaaaaa", "sub"));
    await mkdir(path.join(tmp.dataDir, "other"));
    const { errors } = await validateData(tmp.dataDir);
    expect(errors.map((e) => e.path).sort()).toEqual(["books/aaaaaaaa/sub", "other"]);
  });

  it("reports id mismatch, unknown topic, suspicious keys, invalid book", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    await writeFakeBook(tmp.dataDir, { id: "bbbbbbbb", topic: "ghost" });
    await writeFakeBook(tmp.dataDir, { id: "cccccccc", driveFileId: "1abc", nested: { md5: "z" } });
    await writeFakeBook(tmp.dataDir, { id: "dddddddd", title: "" });
    await mkdir(path.join(tmp.dataDir, "books", "eeeeeeee"));
    await writeFakeBook(tmp.dataDir, { id: "ffffffff" });
    const { rename } = await import("node:fs/promises");
    await rename(
      path.join(tmp.dataDir, "books", "ffffffff"),
      path.join(tmp.dataDir, "books", "gggggggg"),
    );
    const { errors, warnings } = await validateData(tmp.dataDir);
    const text = messages(errors);
    expect(text).toContain('unknown topic "ghost"');
    expect(text).toContain("driveFileId: key looks like a file identifier");
    expect(text).toContain("nested.md5: key looks like a file identifier");
    expect(text).toContain("does not match its folder");
    expect(errors.some((e) => e.path === "books/dddddddd")).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe("books/eeeeeeee");
  });

  it("flags Drive URLs, EPUB paths and hex digests in values and unusual keys, with the JSON path", async () => {
    const md5 = "d41d8cd98f00b204e9800998ecf8427e";
    await writeFakeBook(tmp.dataDir, {
      id: "aaaaaaaa",
      link: "https://drive.google.com/file/d/1AbC/view",
      file: "Archivio/Narrativa/x [aaaaaaaa].epub",
      checksum: md5,
      notes: { see: ["ok", `sha256 ${"a".repeat(64)}`, "docs.google.com/document/d/1"] },
      anything: "Archivio/x.KEPUB.EPUB",
      fileUrl: "x",
      remote_digest: "x",
    });
    const { errors } = await validateData(tmp.dataDir);
    const text = messages(errors);
    for (const needle of [
      "link: key looks like",
      "link: value looks like a Google Drive/Docs URL",
      "file: value looks like an EPUB file name or path",
      "checksum: value looks like a hex digest",
      "notes.see[1]: value looks like a hex digest",
      "notes.see[2]: value looks like a Google Drive/Docs URL",
      "anything: value looks like an EPUB file name or path",
      "fileUrl: key looks like",
      "remote_digest: key looks like",
    ]) {
      expect(text).toContain(needle);
    }
    expect(errors.every((e) => e.path === "books/aaaaaaaa/book.json")).toBe(true);
  });

  it("does not flag legitimate fields or ordinary text", async () => {
    await writeFakeBook(tmp.dataDir, {
      id: "aaaaaaaa",
      openLibraryCoverId: 4242,
      isbn: "9788800000000",
      profile: "x",
      description: "Un libro su file, link e url di epub antichi. Hash di 12345678 non conta.",
      tags: ["a1b2c3d4"],
    });
    expect(await validateData(tmp.dataDir)).toEqual({ errors: [], warnings: [] });
  });

  it("reports invalid or missing topics.json", async () => {
    const missing = await makeTempDataDir({ topics: false });
    const invalid = await makeTempDataDir({ topics: [{ id: "narrativa", label: "N" }] });
    try {
      expect(messages((await validateData(missing.dataDir)).errors)).toContain("missing");
      expect((await validateData(invalid.dataDir)).errors[0]!.path).toBe("topics.json");
    } finally {
      await missing.cleanup();
      await invalid.cleanup();
    }
  });
});
