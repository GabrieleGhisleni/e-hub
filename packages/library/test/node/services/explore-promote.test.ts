import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheExploreBookDir, cachedEpubPath } from "../../../src/node/cache/index.ts";
import { readBook } from "../../../src/node/repo/index.ts";
import { promoteExploreBook } from "../../../src/node/services/index.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { type ServicesTestEnv, setupServices } from "./setup.ts";

const ID = "ex4mp1e8";

describe.skipIf(!hasBinary("kepubify"))("promoteExploreBook", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
    const dir = cacheExploreBookDir(t.env.cacheDir, ID);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "book.epub"), await buildEpub());
    await writeFile(path.join(dir, "summary.json"), "{}");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("makes a library book with the same ID, uploads it to the Kobo and drops the explore copy", async () => {
    const { book, report } = await promoteExploreBook(t.ctx, { id: ID, topic: "narrativa" });
    expect(report.errors).toEqual([]);
    expect(book).toMatchObject({ id: ID, topic: "narrativa", status: "to-read" });
    expect(await readBook(t.ctx.dataDir, ID)).toMatchObject({ id: ID });

    const files = await readdir(t.env.koboDir);
    expect(files).toContain(koboFileName(book, "kepub"));
    expect(files).toContain(koboFileName(book, "sidecar"));
    const sidecar = await readFile(
      path.join(t.env.koboDir, koboFileName(book, "sidecar"), "custom_metadata.lua"),
      "utf8",
    );
    expect(sidecar).toContain('["series"] = "Narrativa"');

    expect((await readFile(cachedEpubPath(t.env.cacheDir, ID))).byteLength).toBeGreaterThan(0);
    await expect(readdir(cacheExploreBookDir(t.env.cacheDir, ID))).rejects.toThrow();
    expect(await readFile(path.join(t.ctx.dataDir, "books", ID, "summary.json"), "utf8")).toBe("{}");
  });

  it("an already promoted book is not made twice", async () => {
    await promoteExploreBook(t.ctx, { id: ID, topic: "narrativa" });
    const again = await promoteExploreBook(t.ctx, { id: ID, topic: "saggistica" });
    expect(again.book.topic).toBe("narrativa");
  });

  it("rejects an unknown topic and a missing EPUB", async () => {
    await expect(promoteExploreBook(t.ctx, { id: ID, topic: "nope" })).rejects.toMatchObject({ code: "unknown-topic" });
    await expect(promoteExploreBook(t.ctx, { id: "zzzz0000", topic: "narrativa" })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
