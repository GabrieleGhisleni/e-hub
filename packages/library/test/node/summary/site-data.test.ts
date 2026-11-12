import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBookSummary, summaryPath } from "../../../src/node/repo/index.ts";
import { buildSiteData } from "../../../src/node/site-data/index.ts";
import { BookDetailSchema } from "../../../src/shared/schema.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/index.ts";
import { writeFakeBook } from "../site-data/fixtures.ts";
import { sampleSummary } from "./helpers.ts";

const opts = { basePath: "/e-library/" };
let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(() => tmp.cleanup());

describe("site data: summary of the book detail", () => {
  it("publishes the summary without version, bookId or word counts", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    await writeBookSummary(tmp.dataDir, sampleSummary());
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.problems).toEqual([]);
    const detail = BookDetailSchema.parse(data.details.get("aaaaaaaa"));
    expect(detail.summary).toEqual({
      language: "it",
      model: "smart",
      generatedAt: "2026-11-12T10:00:00.000Z",
      book: "Un saggio breve sul tempo.",
      chapters: [
        { n: 1, title: "Copertina", summary: null },
        { n: 2, title: "Le ore", summary: "Il tempo vissuto si allunga." },
      ],
    });
  });

  it("publishes null when the book has no summary", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.problems).toEqual([]);
    expect(data.details.get("aaaaaaaa")!.summary).toBeNull();
  });

  it("publishes null and reports a problem when summary.json is invalid", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    await writeFile(summaryPath(tmp.dataDir, "aaaaaaaa"), "{ broken");
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.details.get("aaaaaaaa")!.summary).toBeNull();
    expect(data.problems).toEqual([
      expect.objectContaining({ id: "aaaaaaaa", message: expect.stringContaining("summary.json") }),
    ]);
  });

  it("a summary whose bookId differs from the folder is a problem too", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" });
    await writeFile(summaryPath(tmp.dataDir, "aaaaaaaa"), JSON.stringify(sampleSummary({ bookId: "bbbbbbbb" })));
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.details.get("aaaaaaaa")!.summary).toBeNull();
    expect(data.problems).toHaveLength(1);
  });
});
