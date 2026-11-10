import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidUploadIdError,
  cacheBookDir,
  cachedEpubPath,
  cachedKepubPath,
  cachedTextDir,
  ensureDir,
  highlightsDir,
  isNonEmptyFile,
  isUploadId,
  newUploadId,
  removeCachedBook,
  uploadDir,
} from "../../../src/node/cache/index.ts";
import { InvalidBookIdError } from "../../../src/node/repo/index.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";

describe("cache layout", () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir("elib-cache-");
  });
  afterEach(async () => {
    await tmp.cleanup();
  });

  it("builds the documented paths", () => {
    const c = "/home/u/.cache/e-library";
    expect(cachedEpubPath(c, "7k2m9q4t")).toBe(`${c}/books/7k2m9q4t/book.epub`);
    expect(cachedKepubPath(c, "7k2m9q4t")).toBe(`${c}/books/7k2m9q4t/book.kepub.epub`);
    expect(cachedTextDir(c, "7k2m9q4t")).toBe(`${c}/books/7k2m9q4t/text`);
    const id = newUploadId();
    expect(uploadDir(c, id)).toBe(`${c}/uploads/${id}`);
    expect(highlightsDir(c)).toBe(`${c}/highlights`);
  });

  it("rejects book and upload IDs that could escape the cache", () => {
    for (const bad of ["../x", "7K2M9Q4T", "", "7k2m9q4t/..", "abc"]) {
      expect(() => cacheBookDir("/c", bad)).toThrow(InvalidBookIdError);
    }
    for (const bad of ["../x", "", "not-a-uuid", "../../00000000-0000-4000-8000-000000000000"]) {
      expect(isUploadId(bad)).toBe(false);
      expect(() => uploadDir("/c", bad)).toThrow(InvalidUploadIdError);
    }
  });

  it("generates distinct, valid upload IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newUploadId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isUploadId(id)).toBe(true);
  });

  it("ensureDir, isNonEmptyFile and removeCachedBook", async () => {
    const dir = await ensureDir(path.join(tmp.dir, "books", "7k2m9q4t", "text"));
    expect((await stat(dir)).isDirectory()).toBe(true);
    await ensureDir(dir); // idempotent
    const epub = cachedEpubPath(tmp.dir, "7k2m9q4t");
    expect(await isNonEmptyFile(epub)).toBe(false);
    await writeFile(epub, "");
    expect(await isNonEmptyFile(epub)).toBe(false);
    await writeFile(epub, "x");
    expect(await isNonEmptyFile(epub)).toBe(true);
    expect(await isNonEmptyFile(dir)).toBe(false);
    await removeCachedBook(tmp.dir, "7k2m9q4t");
    expect(await readdir(path.join(tmp.dir, "books"))).toEqual([]);
    await removeCachedBook(tmp.dir, "7k2m9q4t"); // missing: no-op
  });
});
