import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import { reconcile } from "../../../src/node/drive/index.ts";
import type { ReconcileReport } from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { type DriveTestEnv, ID_A, makeBook, setupDrive } from "./setup.ts";

const summary = (report: ReconcileReport): string[] =>
  report.actions.map((a) => `${a.type}:${a.status}:${a.from ?? ""}->${a.to ?? ""}`);

function hasKoboSpans(bytes: Uint8Array): boolean {
  const files = unzipSync(bytes);
  return Object.entries(files).some(
    ([name, data]) => name.endsWith(".xhtml") && strFromU8(data).includes("koboSpan"),
  );
}

describe.skipIf(!hasBinary("rclone") || !hasBinary("kepubify"))("KEPUB regeneration", () => {
  let t: DriveTestEnv;
  let epubBytes: Uint8Array;
  beforeEach(async () => {
    t = await setupDrive();
    epubBytes = await buildEpub();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("regenerates a missing KEPUB from the cached EPUB", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { epub: epubBytes });
    const exp = await t.expected(book);
    await t.put(exp.epub, epubBytes);

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual(["kepub-regenerated"]);
    expect(summary(report)).toEqual([
      `upload:done:${cachedKepubPath(t.env.cacheDir, ID_A)}->${exp.kepub}`,
    ]);
    const cached = new Uint8Array(await readFile(cachedKepubPath(t.env.cacheDir, ID_A)));
    expect(hasKoboSpans(cached)).toBe(true);
    expect(hasKoboSpans(epubBytes)).toBe(false);
    expect(new Uint8Array((await t.read(exp.kepub)) ?? [])).toEqual(cached);
    expect((await reconcile(t.ctx, [ID_A])).actions).toEqual([]);
  });

  it("downloads a Drive-only EPUB into the cache (after moving it) and regenerates the KEPUB", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book); // nothing in the cache
    const exp = await t.expected(book);
    const misplaced = "Archivio/Filosofia/Vecchio nome [7k2m9q4t].epub";
    await t.put(misplaced, epubBytes);

    const snap = await t.snapshot();
    const planned = await reconcile(t.ctx, [ID_A], { dryRun: true });
    expect(await t.snapshot()).toEqual(snap); // no download, no conversion in a dry run
    expect(planned.errors).toEqual([]);
    expect(summary(planned)).toEqual([
      `move:planned:${misplaced}->${exp.epub}`,
      `upload:planned:${cachedKepubPath(t.env.cacheDir, ID_A)}->${exp.kepub}`,
      "rmdir:planned:Archivio/Filosofia->",
    ]);

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual(summary(planned).map((s) => s.replace(":planned:", ":done:")));
    expect(new Uint8Array(await readFile(cachedEpubPath(t.env.cacheDir, ID_A)))).toEqual(epubBytes);
    const kepub = new Uint8Array((await t.read(exp.kepub)) ?? []);
    expect(hasKoboSpans(kepub)).toBe(true);
    expect(await t.remoteFiles()).toEqual([exp.epub, exp.kepub].sort());
    expect((await reconcile(t.ctx, [ID_A])).actions).toEqual([]);
  });
});
