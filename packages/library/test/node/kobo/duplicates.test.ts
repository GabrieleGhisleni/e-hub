import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDuplicatesInCache, md5File } from "../../../src/node/kobo/index.ts";
import { makeTrackedTempDir } from "../../helpers/tmp.ts";

const ID_A = "7k2m9q4t";
const ID_B = "a1b2c3d4";

describe("findDuplicatesInCache", () => {
  it("matches the MD5 of cached EPUBs, sorted, ignoring folders that are not book IDs", async () => {
    const cache = await makeTrackedTempDir("elib-dup-");
    const local = path.join(cache, "incoming.epub");
    await writeFile(local, "SAME CONTENT");
    for (const [id, content] of [
      [ID_A, "SAME CONTENT"],
      [ID_B, "OTHER CONTENT"],
    ] as const) {
      await mkdir(path.join(cache, "books", id), { recursive: true });
      await writeFile(path.join(cache, "books", id, "book.epub"), content);
    }
    await mkdir(path.join(cache, "books", "not-an-id"), { recursive: true });
    await writeFile(path.join(cache, "books", "not-an-id", "book.epub"), "SAME CONTENT");

    expect(await findDuplicatesInCache(cache, local)).toEqual([
      {
        kind: "md5",
        path: path.join(cache, "books", ID_A, "book.epub"),
        bookId: ID_A,
      },
    ]);
  });

  it("returns nothing when the cache has no books folder", async () => {
    const cache = await makeTrackedTempDir("elib-dup-empty-");
    const local = path.join(cache, "incoming.epub");
    await writeFile(local, "X");
    expect(await findDuplicatesInCache(cache, local)).toEqual([]);
  });

  it("md5File gives the lowercase hex digest", async () => {
    const dir = await makeTrackedTempDir("elib-md5-");
    const file = path.join(dir, "f");
    await writeFile(file, "abc");
    expect(await md5File(file)).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});
