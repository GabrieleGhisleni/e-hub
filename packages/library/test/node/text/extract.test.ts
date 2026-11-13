import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath } from "../../../src/node/cache/index.ts";
import {
  EpubNotFoundError,
  UnsafeTextOutputError,
  assertOutsideRepo,
  extractBookText,
} from "../../../src/node/text/index.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { type TestEnv, buildEpub, createTestEnv, makeTempDir } from "../../helpers/index.ts";

const ID = "7k2m9q4t";

describe("extractBookText", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    await writeBook(env.dataDir, {
      id: ID,
      title: "Il giardino delle prove",
      authors: ["Ada Esempio"],
      topic: "narrativa",
      status: "to-read",
    });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  const makeCtx = () => ({ dataDir: env.dataDir, cacheDir: env.cacheDir });
  const putEpub = async () => {
    const file = cachedEpubPath(env.cacheDir, ID);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await buildEpub());
  };

  it("writes chapters, index and manifest into <cache>/books/<id>/text", async () => {
    await putEpub();
    const result = await extractBookText(makeCtx(), ID, {
      now: () => new Date("2026-11-10T10:00:00Z"),
    });
    expect(result.skipped).toBe(false);
    expect(result.outputDir).toBe(path.join(env.cacheDir, "books", ID, "text"));
    expect((await readdir(result.outputDir)).sort()).toEqual([
      "00-index.md",
      "01-capitolo-primo.md",
      "02-capitolo-secondo.md",
      "03-capitolo-terzo.md",
      "manifest.json",
    ]);
    const manifest = JSON.parse(
      await readFile(path.join(result.outputDir, "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      id: ID,
      title: "Il giardino delle prove",
      authors: ["Ada Esempio"],
      generatedAt: "2026-11-10T10:00:00.000Z",
    });
    expect(manifest.chapters).toHaveLength(3);
    expect(manifest.chapters[0]).toMatchObject({
      n: 1,
      file: "01-capitolo-primo.md",
      title: "Capitolo primo",
    });
    expect(manifest.chapters[0].words).toBeGreaterThan(0);
    const index = await readFile(path.join(result.outputDir, "00-index.md"), "utf8");
    expect(index).toContain("# Il giardino delle prove");
    expect(index).toContain("[Capitolo secondo](02-capitolo-secondo.md)");
    const chapter = await readFile(path.join(result.outputDir, "01-capitolo-primo.md"), "utf8");
    expect(chapter).toContain("# Capitolo primo");
    expect((await readdir(path.join(env.cacheDir, "books", ID))).sort()).toEqual([
      "book.epub",
      "text",
    ]);
  });

  it("skips when the output exists, regenerates with force, and leaves no temp dirs", async () => {
    await putEpub();
    const ctx = makeCtx();
    const first = await extractBookText(ctx, ID);
    const marker = path.join(first.outputDir, "01-capitolo-primo.md");
    const old = new Date("2020-01-01T00:00:00Z");
    await utimes(marker, old, old);

    const second = await extractBookText(ctx, ID);
    expect(second.skipped).toBe(true);
    expect(second.manifest.chapters).toHaveLength(3);
    expect((await stat(marker)).mtime.getTime()).toBe(old.getTime());

    const third = await extractBookText(ctx, ID, { force: true });
    expect(third.skipped).toBe(false);
    expect((await stat(marker)).mtime.getTime()).toBeGreaterThan(old.getTime());
    expect(await readdir(path.join(env.cacheDir, "books", ID))).not.toContain(
      expect.stringMatching(/tmp|old/),
    );
  });

  it("keeps the previous output when regeneration fails", async () => {
    await putEpub();
    const ctx = makeCtx();
    await extractBookText(ctx, ID);
    await writeFile(cachedEpubPath(env.cacheDir, ID), "not an epub");
    await expect(extractBookText(ctx, ID, { force: true })).rejects.toThrow();
    const names = await readdir(path.join(env.cacheDir, "books", ID, "text"));
    expect(names).toContain("manifest.json");
    expect(await readdir(path.join(env.cacheDir, "books", ID))).toEqual(["book.epub", "text"]);
  });

  it("rejects invalid IDs", async () => {
    await expect(extractBookText(makeCtx(), "../evil")).rejects.toThrow(/invalid book ID/);
  });

  it("rejects with EpubNotFoundError when the EPUB is not in the local cache", async () => {
    await expect(extractBookText(makeCtx(), ID)).rejects.toThrow(EpubNotFoundError);
  });
});

describe("repo guard", () => {
  it("refuses an output dir inside the repo root, and the root itself", async () => {
    const tmp = await makeTempDir("elib-guard-");
    try {
      await expect(assertOutsideRepo(path.join(tmp.dir, "cache", "text"), tmp.dir)).rejects.toThrow(
        UnsafeTextOutputError,
      );
      await expect(assertOutsideRepo(tmp.dir, tmp.dir)).rejects.toThrow(UnsafeTextOutputError);
      await expect(
        assertOutsideRepo(path.join(tmp.dir, "..", "elsewhere"), tmp.dir),
      ).resolves.toBeUndefined();
    } finally {
      await tmp.cleanup();
    }
  });

  it("refuses to write when the cache sits inside the repo", async () => {
    const env = await createTestEnv();
    try {
      const ctx = { dataDir: env.dataDir, cacheDir: env.cacheDir };
      await expect(
        extractBookText(ctx, ID, { repoRoot: path.dirname(env.cacheDir) }),
      ).rejects.toThrow(UnsafeTextOutputError);
      await expect(stat(path.join(env.cacheDir, "books"))).rejects.toThrow();
    } finally {
      await env.cleanup();
    }
  });

  it("the default repo root is the real repository", async () => {
    await expect(assertOutsideRepo(path.join(process.cwd(), "data", "text"))).rejects.toThrow(
      UnsafeTextOutputError,
    );
  });
});
