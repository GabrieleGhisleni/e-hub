import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type KoboContext,
  KOREADER_METADATA_FILE,
  createKoboContext,
  formatHighlightsReport,
  highlightsFromMetadata,
  localTransport,
  parseLuaTable,
  pullHighlights,
} from "../../../src/node/kobo/index.ts";
import { readBookHighlights, writeBook } from "../../../src/node/repo/index.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { type TestEnv, createTestEnv } from "../../helpers/test-env.ts";

/** A KOReader `metadata.epub.lua` like the ones on the Kobo, with the given annotation entries. */
function metadataLua(annotations: string[]): string {
  return [
    "-- /mnt/onboard/books/Seneca - La brevità della vita [eec5cpre].kepub.sdr/metadata.epub.lua",
    "return {",
    '    ["annotations"] = {',
    ...annotations.map((a, i) => `        [${i + 1}] = {\n${a}\n        },`),
    "    },",
    '    ["doc_pages"] = 132,',
    '    ["percent_finished"] = 0.40909090909091,',
    '    ["summary"] = {',
    '        ["status"] = "reading",',
    "    },",
    "}",
    "",
  ].join("\n");
}

function annotation(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([k, v]) => `            ["${k}"] = ${typeof v === "number" ? v : JSON.stringify(v)},`)
    .join("\n");
}

const pos = (fragment: number, span: number, offset = 0) =>
  `/body/DocFragment[${fragment}]/body/div/div/p/span[${span}]/text().${offset}`;

describe("parseLuaTable", () => {
  it("reads strings with escapes, numbers, booleans, nested tables and the array part", () => {
    const table = parseLuaTable(
      [
        "-- comment",
        "return {",
        '    ["a"] = "riga\\nnuova \\"citata\\" \\226\\128\\148 fine",',
        '    ["n"] = -1.5e2,',
        '    ["yes"] = true, ["no"] = false, ["gone"] = nil;',
        "    plain = 'x',",
        '    ["list"] = { "uno", "due", [5] = "cinque" },',
        "}",
      ].join("\n"),
    );
    expect(table.a).toBe('riga\nnuova "citata" — fine');
    expect(table.n).toBe(-150);
    expect(table.yes).toBe(true);
    expect(table.no).toBe(false);
    expect(table).not.toHaveProperty("gone");
    expect(table.plain).toBe("x");
    expect(table.list).toEqual({ "1": "uno", "2": "due", "5": "cinque" });
  });

  it("fails on broken input", () => {
    expect(() => parseLuaTable('return { ["a"] = "unterminated }')).toThrow(/unterminated/);
    expect(() => parseLuaTable("return { } extra")).toThrow(/after the table/);
  });
});

describe("highlightsFromMetadata", () => {
  it("keeps the reading order (book position), not the creation order, and skips page bookmarks", () => {
    const lua = metadataLua([
      annotation({ chapter: "II", datetime: "2026-11-11 22:10:00", pageno: 18, pos0: pos(7, 25), text: "Secondo." }),
      annotation({ chapter: "I", datetime: "2026-11-11 22:12:00", pageno: 15, pos0: pos(6, 17), text: "Primo." }),
      // A page bookmark: no pos0.
      annotation({ chapter: "II", datetime: "2026-11-11 22:13:00", page: pos(7, 1), pageno: 17 }),
      annotation({
        chapter: "II",
        datetime: "2026-11-11 22:14:00",
        note: "Da rileggere",
        pageno: 18,
        pos0: pos(7, 12, 3),
        text: "Prima del secondo,\n  su due righe.",
      }),
    ]);
    const highlights = highlightsFromMetadata(parseLuaTable(lua));
    expect(highlights.map((h) => h.text)).toEqual(["Primo.", "Prima del secondo, su due righe.", "Secondo."]);
    expect(highlights[1]).toEqual({
      text: "Prima del secondo, su due righe.",
      note: "Da rileggere",
      chapter: "II",
      page: 18,
      pos: pos(7, 12, 3),
      createdAt: "2026-11-11 22:14:00",
    });
  });

  it("drops exact duplicates", () => {
    const entry = annotation({ chapter: "I", pageno: 3, pos0: pos(2, 1), text: "Uguale." });
    expect(highlightsFromMetadata(parseLuaTable(metadataLua([entry, entry])))).toHaveLength(1);
  });

  it("reads the older `highlight` table (by page) when there are no annotations", () => {
    const lua = [
      "return {",
      '    ["highlight"] = {',
      '        [40] = { [1] = { ["chapter"] = "B", ["pos0"] = "' + pos(9, 2) + '", ["text"] = "Dopo." } },',
      '        [12] = { [1] = { ["chapter"] = "A", ["pos0"] = "' + pos(4, 2) + '", ["text"] = "Prima." } },',
      "    },",
      "}",
    ].join("\n");
    const highlights = highlightsFromMetadata(parseLuaTable(lua));
    expect(highlights.map((h) => [h.text, h.page])).toEqual([
      ["Prima.", 12],
      ["Dopo.", 40],
    ]);
  });
});

describe("pullHighlights", () => {
  let env: TestEnv;
  let ctx: KoboContext;
  const book: Book = {
    id: "eec5cpre",
    title: "La brevità della vita",
    authors: ["Seneca"],
    topic: "narrativa",
    status: "reading",
  };
  const sidecarFile = `${koboFileName(book, "sidecar")}/${KOREADER_METADATA_FILE}`;
  const putOnKobo = async (relPath: string, content: string) => {
    const file = path.join(env.koboDir, ...relPath.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  };
  const two = metadataLua([
    annotation({ chapter: "I", pageno: 15, pos0: pos(6, 17), text: "Primo." }),
    annotation({ chapter: "II", pageno: 18, pos0: pos(7, 25), text: "Secondo." }),
  ]);

  beforeEach(async () => {
    env = await createTestEnv();
    ctx = createKoboContext(
      {
        kobo: { host: "root@127.0.0.1", port: 2222, identityFile: "/none", booksDir: "/mnt/onboard/books" },
        dataDir: env.dataDir,
        cache: { dir: env.cacheDir },
      },
      { transport: localTransport(env.koboDir) },
    );
    await writeBook(env.dataDir, book);
  });
  afterEach(async () => env.cleanup());

  const now = () => new Date("2026-11-13T09:00:00.000Z");

  it("writes highlights.json, then reports nothing new on the next run", async () => {
    await putOnKobo(sidecarFile, two);
    const first = await pullHighlights(ctx, [book], { now });
    expect(first.items).toEqual([
      { bookId: book.id, title: book.title, status: "updated", count: 2, added: 2, removed: 0 },
    ]);
    const saved = await readBookHighlights(env.dataDir, book.id);
    expect(saved?.syncedAt).toBe("2026-11-13T09:00:00.000Z");
    expect(saved?.highlights.map((h) => h.text)).toEqual(["Primo.", "Secondo."]);

    const second = await pullHighlights(ctx, [book], { now });
    expect(second.items[0]?.status).toBe("unchanged");
    expect(formatHighlightsReport(second)[0]).toBe("Highlights: 2 in 1 book(s), nothing new");
  });

  it("follows deletions on the Kobo, but keeps the saved ones when the Kobo has none at all", async () => {
    await putOnKobo(sidecarFile, two);
    await pullHighlights(ctx, [book], { now });

    await putOnKobo(sidecarFile, metadataLua([annotation({ chapter: "I", pageno: 15, pos0: pos(6, 17), text: "Primo." })]));
    const fewer = await pullHighlights(ctx, [book], { now });
    expect(fewer.items[0]).toMatchObject({ status: "updated", count: 1, added: 0, removed: 1 });

    await putOnKobo(sidecarFile, metadataLua([]));
    const none = await pullHighlights(ctx, [book], { now });
    expect(none.items[0]).toMatchObject({ status: "kept", count: 1 });
    expect((await readBookHighlights(env.dataDir, book.id))?.highlights).toHaveLength(1);
  });

  it("writes nothing in a dry run, and ignores books without a sidecar or metadata file", async () => {
    await putOnKobo(sidecarFile, two);
    const other: Book = { ...book, id: "a1b2c3d4", title: "Altro" };
    await writeBook(env.dataDir, other);
    const dry = await pullHighlights(ctx, [book, other], { dryRun: true });
    expect(dry.items.map((i) => [i.bookId, i.status])).toEqual([[book.id, "updated"]]);
    expect(await readBookHighlights(env.dataDir, book.id)).toBeNull();
  });

  it("finds a sidecar not yet renamed by its [id]", async () => {
    await putOnKobo(`Vecchio nome [${book.id}].kepub.sdr/${KOREADER_METADATA_FILE}`, two);
    const report = await pullHighlights(ctx, [book]);
    expect(report.items[0]?.count).toBe(2);
  });

  it("reports an unreadable metadata file as an error for that book", async () => {
    await putOnKobo(sidecarFile, "return { broken");
    const report = await pullHighlights(ctx, [book]);
    expect(report.items).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.bookId).toBe(book.id);
  });
});
