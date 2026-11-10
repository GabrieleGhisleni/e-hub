import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../src/node/config/index.ts";
import { type TempDataDir, makeTempDataDir, makeTempDir } from "../../helpers/index.ts";
import { writeFakeBook } from "../site-data/fixtures.ts";

let tmp: TempDataDir;
let out: Awaited<ReturnType<typeof makeTempDir>>;
beforeEach(async () => {
  tmp = await makeTempDataDir();
  out = await makeTempDir("elib-out-");
});
afterEach(async () => {
  await tmp.cleanup();
  await out.cleanup();
});

/** Minimal app root (its own index.html) so the build does not depend on the package root. */
const APP_ROOT = path.join(import.meta.dirname, "fixtures", "app");

async function runBuild(): Promise<void> {
  const previous = process.env.ELIB_DATA_DIR;
  process.env.ELIB_DATA_DIR = tmp.dataDir;
  try {
    await build({
      root: APP_ROOT,
      configFile: path.join(REPO_ROOT, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir: path.join(out.dir, "dist"), emptyOutDir: true },
    });
  } finally {
    if (previous === undefined) delete process.env.ELIB_DATA_DIR;
    else process.env.ELIB_DATA_DIR = previous;
  }
}

describe("vite build with elibData", () => {
  it("emits data files, hashed cover and 404.html identical to index.html", async () => {
    await writeFakeBook(
      tmp.dataDir,
      { id: "aaaaaaaa", title: "Libro" },
      { "cover.webp": "webp", "notes.md": "**ciao**" },
    );
    await runBuild();
    const dist = path.join(out.dir, "dist");
    const index = JSON.parse(await readFile(path.join(dist, "data/index.json"), "utf8"));
    expect(index.books).toHaveLength(1);
    const detail = JSON.parse(await readFile(path.join(dist, "data/books/aaaaaaaa.json"), "utf8"));
    expect(detail.notesHtml).toContain("<strong>ciao</strong>");
    const covers = await readdir(path.join(dist, "data/covers"));
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatch(/^aaaaaaaa\.[0-9a-f]{8}\.webp$/);
    expect(index.books[0].coverUrl).toMatch(/\/data\/covers\/aaaaaaaa\.[0-9a-f]{8}\.webp$/);
    expect(await readFile(path.join(dist, "404.html"), "utf8")).toBe(
      await readFile(path.join(dist, "index.html"), "utf8"),
    );
  }, 60_000);

  it("fails the build when data/ contains a forbidden file", async () => {
    await writeFakeBook(tmp.dataDir, { id: "aaaaaaaa" }, { "book.epub": "x" });
    await expect(runBuild()).rejects.toThrow(/data validation failed/);
  }, 60_000);
});
