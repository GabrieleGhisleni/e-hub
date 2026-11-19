import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSiteData } from "../../../src/node/site-data/index.ts";
import { type TempDataDir, makeTempDataDir } from "../../helpers/index.ts";
import { writeFakeBook } from "./fixtures.ts";

let tmp: TempDataDir;
beforeEach(async () => {
  tmp = await makeTempDataDir();
});
afterEach(() => tmp.cleanup());

const opts = { basePath: "/e-library/" };

describe("buildSiteData", () => {
  it("builds card, detail, cover with hash, rendered Markdown", async () => {
    const cover = Buffer.from("fake-webp-bytes");
    const hash = createHash("sha256").update(cover).digest("hex").slice(0, 8);
    await writeFakeBook(
      tmp.dataDir,
      {
        id: "aaaaaaaa",
        title: "Pensieri lenti",
        tags: ["x"],
        rating: 4,
        publisher: "P",
        pages: 512,
        year: 2011,
      },
      {
        "cover.webp": cover,
        "notes.md": "# Ciao\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>x</script>",
      },
    );
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.problems).toEqual([]);
    const card = data.index.books[0]!;
    expect(card.coverUrl).toBe(`/e-library/data/covers/aaaaaaaa.${hash}.webp`);
    expect(card.tags).toEqual(["x"]);
    expect(card).toMatchObject({ pages: 512, publisher: "P", year: 2011 });
    expect(data.index.topics.map((t) => t.id)).toContain("unsorted");
    expect(data.covers.get(`aaaaaaaa.${hash}.webp`)).toBe(
      path.join(tmp.dataDir, "books", "aaaaaaaa", "cover.webp"),
    );
    const detail = data.details.get("aaaaaaaa")!;
    expect(detail.publisher).toBe("P");
    expect(detail.notesHtml).toContain("<h1>Ciao</h1>");
    expect(detail.notesHtml).toContain("<table>");
    expect(detail.notesHtml).not.toContain("<script>");
    expect(detail.recallHtml).toBeNull();
    expect(detail.studyHtml).toBeNull();
  });

  it("cover null without cover.webp; blank Markdown is null; unknown fields are not published", async () => {
    await writeFakeBook(
      tmp.dataDir,
      { id: "bbbbbbbb", secretNote: "private", extra: { a: 1 } },
      { "recall.md": "  \n\n" },
    );
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.index.books[0]!.coverUrl).toBeNull();
    expect(data.covers.size).toBe(0);
    const detail = data.details.get("bbbbbbbb")!;
    expect(detail.recallHtml).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("private");
    expect(Object.keys(detail)).not.toContain("extra");
    expect(JSON.stringify(data.index)).not.toContain("private");
  });

  it("skips incomplete folders and reports invalid books and unknown topics", async () => {
    await writeFakeBook(tmp.dataDir, { id: "cccccccc" });
    await mkdir(path.join(tmp.dataDir, "books", "dddddddd"));
    await writeFakeBook(tmp.dataDir, { id: "eeeeeeee", title: "" });
    await writeFakeBook(tmp.dataDir, { id: "ffffffff", topic: "nope" });
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.index.books.map((b) => b.id)).toEqual(["cccccccc"]);
    expect(data.problems.map((p) => p.id).sort()).toEqual(["eeeeeeee", "ffffffff"]);
  });

  it("publishes at most two sentences from an older highlight and keeps its note", async () => {
    await writeFakeBook(
      tmp.dataDir,
      { id: "aaaaaaaa" },
      {
        "highlights.json": JSON.stringify({
          version: 1,
          bookId: "aaaaaaaa",
          syncedAt: "2026-11-12T10:00:00.000Z",
          highlights: [
            {
              text: "Prima frase.\n\nSeconda frase. Terza frase.",
              note: "Nota personale.",
              pos: "/body/DocFragment[2]",
            },
          ],
        }),
      },
    );
    const detail = (await buildSiteData(tmp.dataDir, opts)).details.get("aaaaaaaa");
    expect(detail?.highlights).toEqual([
      { text: "Prima frase.\n\nSeconda frase. …", note: "Nota personale." },
    ]);
  });

  it("sorts by title with Italian, accent-insensitive collation", async () => {
    await writeFakeBook(tmp.dataDir, { id: "11111111", title: "Zeta" });
    await writeFakeBook(tmp.dataDir, { id: "22222222", title: "Èra" });
    await writeFakeBook(tmp.dataDir, { id: "33333333", title: "Eco" });
    await writeFakeBook(tmp.dataDir, { id: "44444444", title: "alba" });
    const data = await buildSiteData(tmp.dataDir, opts);
    expect(data.index.books.map((b) => b.title)).toEqual(["alba", "Eco", "Èra", "Zeta"]);
  });
});
