import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteBookDir, InvalidDataError, readBookSummary, summaryPath, writeBookSummary } from "../../../src/node/repo/index.ts";
import { validateData } from "../../../src/node/site-data/validate.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/index.ts";
import { writeFakeBook } from "../site-data/fixtures.ts";
import { sampleSummary } from "./helpers.ts";

const ID = "aaaaaaaa";
let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
  await writeFakeBook(tmp.dataDir, { id: ID });
});
afterEach(() => tmp.cleanup());

describe("repo: summary.json", () => {
  it("returns null when the book has no summary", async () => {
    expect(await readBookSummary(tmp.dataDir, ID)).toBeNull();
  });

  it("writes pretty JSON with a trailing newline and reads it back", async () => {
    const written = await writeBookSummary(tmp.dataDir, sampleSummary());
    const text = await readFile(summaryPath(tmp.dataDir, ID), "utf8");
    expect(text).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(await readBookSummary(tmp.dataDir, ID)).toEqual(written);
  });

  it("refuses to write an invalid summary", async () => {
    await expect(
      writeBookSummary(tmp.dataDir, sampleSummary({ book: "   " })),
    ).rejects.toBeInstanceOf(InvalidDataError);
    expect(await readBookSummary(tmp.dataDir, ID)).toBeNull();
  });

  it("reports an invalid file with a clear error (JSON and schema)", async () => {
    const file = summaryPath(tmp.dataDir, ID);
    await writeFile(file, "{ not json");
    await expect(readBookSummary(tmp.dataDir, ID)).rejects.toThrow(/invalid JSON/);
    await writeFile(file, JSON.stringify({ version: 2 }));
    await expect(readBookSummary(tmp.dataDir, ID)).rejects.toBeInstanceOf(InvalidDataError);
  });

  it("rejects a summary whose bookId differs from its folder", async () => {
    await mkdir(path.dirname(summaryPath(tmp.dataDir, ID)), { recursive: true });
    await writeFile(summaryPath(tmp.dataDir, ID), JSON.stringify(sampleSummary({ bookId: "bbbbbbbb" })));
    await expect(readBookSummary(tmp.dataDir, ID)).rejects.toThrow(/does not match its folder/);
  });

  it("deleting a book removes summary.json with the folder", async () => {
    await writeBookSummary(tmp.dataDir, sampleSummary());
    await deleteBookDir(tmp.dataDir, ID);
    await expect(readFile(summaryPath(tmp.dataDir, ID), "utf8")).rejects.toThrow();
  });

  it("validateData accepts summary.json and reports an invalid one", async () => {
    await writeBookSummary(tmp.dataDir, sampleSummary());
    expect((await validateData(tmp.dataDir)).errors).toEqual([]);

    await writeFile(summaryPath(tmp.dataDir, ID), JSON.stringify(sampleSummary({ bookId: "bbbbbbbb" })));
    const result = await validateData(tmp.dataDir);
    expect(result.errors).toEqual([
      expect.objectContaining({ path: `books/${ID}/summary.json` }),
    ]);
    await rm(summaryPath(tmp.dataDir, ID));
  });
});
