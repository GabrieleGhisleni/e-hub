import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath } from "../../../src/node/cache/index.ts";
import {
  bookTextDir,
  ensureBookText,
  exploreBookDir,
  importExploreEpub,
  listLibraryBookRefs,
  newExploreBookId,
  readCachedBookManifest,
  readLibraryBookRef,
  readLibraryBookSummary,
} from "../../../src/node/explore/index.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { UnsafeTextOutputError } from "../../../src/node/text/index.ts";
import { type TestEnv, buildEpub, createTestEnv } from "../../helpers/index.ts";
import { buildCustomEpub } from "../text/custom-epub.ts";

const LIB_ID = "7k2m9q4t";
const OTHER_ID = "3h8w5ncr";

describe("explore facade", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    await writeBook(env.dataDir, {
      id: LIB_ID,
      title: "Il giardino delle prove",
      authors: ["Ada Esempio"],
      topic: "narrativa",
      status: "to-read",
      language: "it",
    });
    await writeBook(env.dataDir, {
      id: OTHER_ID,
      title: "Antologia",
      authors: ["Bruno Prova"],
      topic: "narrativa",
      status: "to-read",
    });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  describe("library refs", () => {
    it("reads a book ref with its site href", async () => {
      const ref = await readLibraryBookRef(LIB_ID, { dataDir: env.dataDir });
      expect(ref).toEqual({
        id: LIB_ID,
        title: "Il giardino delle prove",
        authors: ["Ada Esempio"],
        language: "it",
        href: `/library/book/${LIB_ID}/esempio-il-giardino-delle-prove`,
      });
    });

    it("returns undefined for an unknown or an invalid ID", async () => {
      expect(await readLibraryBookRef("zzzzzzzz", { dataDir: env.dataDir })).toBeUndefined();
      expect(await readLibraryBookRef("../evil", { dataDir: env.dataDir })).toBeUndefined();
    });

    it("lists the refs sorted by title", async () => {
      const refs = await listLibraryBookRefs({ dataDir: env.dataDir });
      expect(refs.map((r) => r.title)).toEqual(["Antologia", "Il giardino delle prove"]);
    });

    it("has no library summary for a book without summary.json, nor for an invalid ID", async () => {
      expect(await readLibraryBookSummary(LIB_ID, { dataDir: env.dataDir })).toBeNull();
      expect(await readLibraryBookSummary("../evil", { dataDir: env.dataDir })).toBeNull();
    });
  });

  describe("newExploreBookId", () => {
    it("avoids the taken IDs and the library folders", async () => {
      const taken = new Set(["aaaaaaaa"]);
      for (let i = 0; i < 20; i++) {
        const id = await newExploreBookId(taken, { dataDir: env.dataDir });
        expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
        expect([LIB_ID, OTHER_ID, "aaaaaaaa"]).not.toContain(id);
      }
    });
  });

  describe("importExploreEpub", () => {
    it("writes the EPUB, the chapters and the manifest, and returns the metadata", async () => {
      const bytes = await buildEpub({ creators: ["Ada Esempio"] });
      const result = await importExploreEpub(
        { id: LIB_ID, bytes, fileName: "saggio.epub" },
        { cacheDir: env.cacheDir },
      );
      const bookDir = path.join(env.cacheDir, "explore", "books", LIB_ID);
      expect(result.textDir).toBe(path.join(bookDir, "text"));
      expect(result.title).toBe("Il giardino delle prove");
      expect(result.authors).toEqual(["Ada Esempio"]);
      expect(result.epub).toEqual({
        fileName: "saggio.epub",
        md5: createHash("md5").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
      expect(result.manifest.chapters).toHaveLength(3);
      expect((await readdir(result.textDir)).sort()).toEqual([
        "00-index.md",
        "01-capitolo-primo.md",
        "02-capitolo-secondo.md",
        "03-capitolo-terzo.md",
        "manifest.json",
      ]);
      expect((await stat(path.join(bookDir, "book.epub"))).size).toBe(bytes.byteLength);
      expect(await readCachedBookManifest("explore", LIB_ID, { cacheDir: env.cacheDir })).toEqual(
        result.manifest,
      );
    });

    it("refuses an output dir inside the repo root and writes nothing", async () => {
      await expect(
        importExploreEpub(
          { id: LIB_ID, bytes: await buildEpub(), fileName: "a.epub" },
          { cacheDir: env.cacheDir, repoRoot: env.cacheDir },
        ),
      ).rejects.toThrow(UnsafeTextOutputError);
      await expect(stat(path.join(env.cacheDir, "explore"))).rejects.toThrow();
    });

    it("explains in Italian when the EPUB has no readable text", async () => {
      const bytes = buildCustomEpub({ docs: { "a.xhtml": "<p></p>" } });
      await expect(
        importExploreEpub(
          { id: LIB_ID, bytes, fileName: "vuoto.epub" },
          { cacheDir: env.cacheDir },
        ),
      ).rejects.toThrow("L'EPUB non contiene testo leggibile.");
    });
  });

  describe("book text", () => {
    it("builds the text dirs of both origins", () => {
      expect(bookTextDir("library", LIB_ID, { cacheDir: env.cacheDir })).toBe(
        path.join(env.cacheDir, "books", LIB_ID, "text"),
      );
      expect(bookTextDir("explore", LIB_ID, { cacheDir: env.cacheDir })).toBe(
        path.join(env.cacheDir, "explore", "books", LIB_ID, "text"),
      );
      expect(exploreBookDir(LIB_ID, { cacheDir: env.cacheDir })).toBe(
        path.join(env.cacheDir, "explore", "books", LIB_ID),
      );
    });

    it("ensureBookText for an explore book without cache gives an Italian error", async () => {
      await expect(ensureBookText("explore", OTHER_ID, { cacheDir: env.cacheDir })).rejects.toThrow(
        `pnpm explore add ${OTHER_ID}`,
      );
    });

    it("ensureBookText for an explore book returns the imported chapters", async () => {
      const imported = await importExploreEpub(
        { id: OTHER_ID, bytes: await buildEpub(), fileName: "a.epub" },
        { cacheDir: env.cacheDir },
      );
      const text = await ensureBookText("explore", OTHER_ID, { cacheDir: env.cacheDir });
      expect(text).toEqual({ textDir: imported.textDir, manifest: imported.manifest });
    });

    it("ensureBookText for a library book reads the cached EPUB", async () => {
      const cacheFile = cachedEpubPath(env.cacheDir, LIB_ID);
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, await buildEpub());
      const text = { dataDir: env.dataDir, cacheDir: env.cacheDir };
      const first = await ensureBookText("library", LIB_ID, { text });
      expect(first.textDir).toBe(path.join(env.cacheDir, "books", LIB_ID, "text"));
      expect(first.manifest.chapters).toHaveLength(3);
      expect(await readCachedBookManifest("library", LIB_ID, { cacheDir: env.cacheDir })).toEqual(
        first.manifest,
      );
    });

    it("readCachedBookManifest is undefined for a missing text or an invalid ID", async () => {
      expect(
        await readCachedBookManifest("explore", OTHER_ID, { cacheDir: env.cacheDir }),
      ).toBeUndefined();
      expect(
        await readCachedBookManifest("explore", "../x", { cacheDir: env.cacheDir }),
      ).toBeUndefined();
    });
  });
});
