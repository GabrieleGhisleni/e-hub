import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryBlobStore, MemoryDocClient, planMigration, runMigration } from "../src/index.ts";

const base = await mkdtemp(path.join(tmpdir(), "migrate-"));
afterAll(() => rm(base, { recursive: true, force: true }));

async function put(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

describe("migration", () => {
  it("plans and uploads documents, covers and EPUBs; leaves unrouted files on disk", async () => {
    const roots = {
      library: path.join(base, "library"),
      explore: path.join(base, "explore"),
      notes: path.join(base, "notes"),
      podcasts: path.join(base, "podcasts"),
    };
    const cache = path.join(base, "cache");
    await put(path.join(roots.library, "books/ab12cd34/book.json"), '{"id":"ab12cd34"}');
    await put(path.join(roots.library, "books/ab12cd34/cover.webp"), "img");
    await put(path.join(roots.library, "books/.gitkeep"), "");
    await put(path.join(roots.explore, "2026-01-01-x.json"), "{}");
    await put(path.join(roots.podcasts, "shows/s.json"), '{"slug":"s"}');
    await put(path.join(roots.podcasts, "transcripts/t.json"), "{}");
    await put(path.join(cache, "books/ab12cd34/book.epub"), "epub");
    await put(path.join(cache, "books/zz/book.kepub.epub"), "k");

    const plan = await planMigration(roots, cache);
    expect(plan.items.map((i) => `${i.root}:${i.key}`)).toEqual([
      "library:books/ab12cd34/book.json",
      "library:books/ab12cd34/cover.webp",
      "explore:2026-01-01-x.json",
      "podcasts:shows/s.json",
      "epub:books/ab12cd34.epub",
    ]);
    expect(plan.skipped).toEqual(["podcasts/transcripts/t.json"]);

    const docs = new MemoryDocClient();
    const blobs = new MemoryBlobStore();
    const result = await runMigration(plan, docs, blobs);
    expect(result).toEqual({ documents: 3, blobs: 2, failed: [] });
    expect((await docs.get("books", "ab12cd34"))?.data).toEqual({ id: "ab12cd34" });
    expect([...blobs.objects.keys()].sort()).toEqual(["books/ab12cd34.epub", "covers/ab12cd34.webp"]);
  });

  it("collects failures instead of throwing", async () => {
    const roots = {
      library: path.join(base, "l2"),
      explore: path.join(base, "e2"),
      notes: path.join(base, "n2"),
      podcasts: path.join(base, "p2"),
    };
    await put(path.join(roots.explore, "bad.json"), "not json");
    const result = await runMigration(await planMigration(roots, path.join(base, "none")), new MemoryDocClient(), new MemoryBlobStore());
    expect(result.failed).toHaveLength(1);
  });
});
