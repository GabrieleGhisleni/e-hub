import { chmod, mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import { createDriveContext, reconcile, reconcileBooks } from "../../../src/node/drive/index.ts";
import { bookDir, writeBook } from "../../../src/node/repo/index.ts";
import type { ReconcileMessage, ReconcileReport } from "../../../src/shared/api.ts";
import { driveFileName } from "../../../src/shared/naming.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import {
  type DriveTestEnv,
  ID_A,
  ID_B,
  ID_C,
  ID_INCOMPLETE,
  ID_INVALID,
  ID_ORPHAN,
  makeBook,
  setupDrive,
} from "./setup.ts";

const summary = (report: ReconcileReport): string[] =>
  report.actions.map((a) => `${a.type}:${a.status}:${a.from ?? ""}->${a.to ?? ""}`);
const codes = (messages: ReconcileMessage[]): string[] => messages.map((m) => m.code).sort();
const noop = { dryRun: false, actions: [], warnings: [], errors: [] };

describe.skipIf(!hasBinary("rclone"))("reconcile on a local rclone remote", () => {
  let t: DriveTestEnv;
  beforeEach(async () => {
    t = await setupDrive();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("uploads missing files from the cache; a second run is a no-op", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { epub: "EPUB-A", kepub: "KEPUB-A" });
    const exp = await t.expected(book);
    expect(exp.kepub).toBe(
      "Rakuten Kobo/Narrativa/Ada Esempio - Il giardino delle prove [7k2m9q4t].kepub.epub",
    );

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(report.actions).toEqual([
      {
        type: "upload",
        status: "done",
        bookId: ID_A,
        tree: "archive",
        from: cachedEpubPath(t.env.cacheDir, ID_A),
        to: exp.epub,
      },
      {
        type: "upload",
        status: "done",
        bookId: ID_A,
        tree: "kobo",
        from: cachedKepubPath(t.env.cacheDir, ID_A),
        to: exp.kepub,
      },
    ]);
    expect((await t.read(exp.epub))?.toString()).toBe("EPUB-A");
    expect((await t.read(exp.kepub))?.toString()).toBe("KEPUB-A");

    expect(await reconcile(t.ctx, [ID_A])).toEqual(noop);
    expect(await reconcile(t.ctx, "all")).toEqual(noop);
  });

  it("moves both files after a topic change and removes the emptied topic folders", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const before = await t.expected(book);
    await t.put(before.epub);
    await t.put(before.kepub);

    const changed = makeBook(ID_A, { topic: "filosofia" });
    await writeBook(t.env.dataDir, changed);
    const after = await t.expected(changed);

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual([
      `move:done:${before.epub}->${after.epub}`,
      `move:done:${before.kepub}->${after.kepub}`,
      "rmdir:done:Rakuten Kobo/Narrativa->",
      "rmdir:done:Archivio/Narrativa->",
    ]);
    expect(await t.remoteFiles()).toEqual([after.epub, after.kepub].sort());
    expect(await t.remoteDirs()).toEqual([
      "Archivio",
      "Archivio/Filosofia",
      "Rakuten Kobo",
      "Rakuten Kobo/Filosofia",
    ]);
    expect(await reconcile(t.ctx, [ID_A])).toEqual(noop);
  });

  it("renames the files after a title change (same folder, no rmdir)", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const before = await t.expected(book);
    await t.put(before.epub);
    await t.put(before.kepub);

    const changed = makeBook(ID_A, {
      title: "Sapiens: Da animali a dèi",
      authors: ["Y. N. Harari"],
    });
    await writeBook(t.env.dataDir, changed);
    const after = await t.expected(changed);
    expect(after.epub).toBe(
      "Archivio/Narrativa/Y. N. Harari - Sapiens - Da animali a dèi [7k2m9q4t].epub",
    );

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual([
      `move:done:${before.epub}->${after.epub}`,
      `move:done:${before.kepub}->${after.kepub}`,
    ]);
    expect(await t.remoteFiles()).toEqual([after.epub, after.kepub].sort());
    expect(await reconcile(t.ctx, [ID_A])).toEqual(noop);
  });

  it("moves files found in the wrong tree", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const exp = await t.expected(book);
    const strayKepub = `Archivio/Narrativa/${driveFileName(book, "kepub")}`;
    const strayEpub = `Rakuten Kobo/${driveFileName(book, "epub")}`;
    await t.put(strayKepub, "K");
    await t.put(strayEpub, "E");

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual([
      `move:done:${strayEpub}->${exp.epub}`,
      `move:done:${strayKepub}->${exp.kepub}`,
    ]);
    expect((await t.read(exp.kepub))?.toString()).toBe("K");
    expect((await t.read(exp.epub))?.toString()).toBe("E");
    expect(await reconcile(t.ctx, [ID_A])).toEqual(noop);
  });

  it("with several misplaced copies moves the best one and reports the others", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const exp = await t.expected(book);
    await t.put(exp.epub);
    const old = "Rakuten Kobo/Saggistica/Vecchio [7k2m9q4t].kepub.epub";
    const best = "Rakuten Kobo/Filosofia/Recente [7k2m9q4t].kepub.epub";
    const wrongTree = "Archivio/Filosofia/Nuovissimo [7k2m9q4t].kepub.epub";
    await t.put(old, "old");
    await t.put(best, "best");
    await t.put(wrongTree, "wrong tree");
    const at = (iso: string): Date => new Date(iso);
    await utimes(t.env.remote.localPath(old), at("2020-01-01"), at("2020-01-01"));
    await utimes(t.env.remote.localPath(best), at("2024-01-01"), at("2024-01-01"));
    await utimes(t.env.remote.localPath(wrongTree), at("2025-01-01"), at("2025-01-01"));

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual([
      `move:done:${best}->${exp.kepub}`,
      "rmdir:done:Rakuten Kobo/Filosofia->",
    ]);
    expect((await t.read(exp.kepub))?.toString()).toBe("best");
    expect(report.warnings.map((w) => [w.code, w.path])).toEqual([
      ["duplicate-file", old],
      ["duplicate-file", wrongTree],
    ]);
  });

  it("warns about duplicates and trashes them only with prune", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const exp = await t.expected(book);
    await t.put(exp.epub);
    await t.put(exp.kepub);
    const dupEpub = "Archivio/Filosofia/Vecchio nome [7k2m9q4t].epub";
    const dupKepub = "Rakuten Kobo/Saggistica/Vecchio nome [7k2m9q4t].kepub.epub";
    await t.put(dupEpub);
    await t.put(dupKepub);

    const warned = await reconcile(t.ctx, [ID_A]);
    expect(warned.actions).toEqual([]);
    expect(warned.errors).toEqual([]);
    expect(warned.warnings.map((w) => [w.code, w.path])).toEqual([
      ["duplicate-file", dupEpub],
      ["duplicate-file", dupKepub],
    ]);
    expect(await t.remoteFiles()).toHaveLength(4);

    const pruned = await reconcile(t.ctx, [ID_A], { prune: true });
    expect(pruned.errors).toEqual([]);
    expect(summary(pruned)).toEqual([
      `trash:done:${dupEpub}->`,
      `trash:done:${dupKepub}->`,
      "rmdir:done:Rakuten Kobo/Saggistica->",
      "rmdir:done:Archivio/Filosofia->",
    ]);
    expect(await t.remoteFiles()).toEqual([exp.epub, exp.kepub].sort());
    expect(await reconcile(t.ctx, [ID_A], { prune: true })).toEqual(noop);
  });

  it("reports orphans and unrecognized files; prune trashes them but never incomplete uploads", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const exp = await t.expected(book);
    await t.put(exp.epub);
    await t.put(exp.kepub);
    const orphan = `Archivio/Narrativa/Qualcuno - Sparito [${ID_ORPHAN}].epub`;
    const unrecognized = "Rakuten Kobo/appunti a caso.pdf";
    const incomplete = `Archivio/Da smistare/Upload a metà [${ID_INCOMPLETE}].epub`;
    const invalid = `Rakuten Kobo/Narrativa/Libro rotto [${ID_INVALID}].kepub.epub`;
    for (const p of [orphan, unrecognized, incomplete, invalid]) await t.put(p);
    // Unfinished upload: the folder exists (cover already written), book.json does not.
    await mkdir(bookDir(t.env.dataDir, ID_INCOMPLETE), { recursive: true });
    await writeFile(path.join(bookDir(t.env.dataDir, ID_INCOMPLETE), "cover.webp"), "x");
    // A book.json that does not validate: its files must never look like orphans.
    await mkdir(bookDir(t.env.dataDir, ID_INVALID), { recursive: true });
    await writeFile(path.join(bookDir(t.env.dataDir, ID_INVALID), "book.json"), "{}\n");

    const single = await reconcile(t.ctx, [ID_A], { prune: true });
    expect(single).toEqual(noop); // orphans are only looked at by a full sync

    const reported = await reconcile(t.ctx, "all");
    expect(reported.actions).toEqual([]);
    expect(reported.errors).toEqual([]);
    expect(codes(reported.warnings)).toEqual([
      "incomplete-upload",
      "invalid-book",
      "orphan-file",
      "unrecognized-file",
    ]);
    expect(await t.remoteFiles()).toHaveLength(6);

    const pruned = await reconcile(t.ctx, "all", { prune: true });
    expect(pruned.errors).toEqual([]);
    expect(summary(pruned)).toEqual([`trash:done:${unrecognized}->`, `trash:done:${orphan}->`]);
    expect(await t.remoteFiles()).toEqual([exp.epub, exp.kepub, incomplete, invalid].sort());

    const again = await reconcile(t.ctx, "all", { prune: true });
    expect(again.actions).toEqual([]);
    expect(codes(again.warnings)).toEqual(["incomplete-upload", "invalid-book"]);
  });

  it("dry run plans everything and writes nothing (remote, cache, data)", async () => {
    const a = makeBook(ID_A);
    await t.addBook(a, { epub: "EPUB-A", kepub: "KEPUB-A" });
    const b = makeBook(ID_B, { title: "Altro" });
    await t.addBook(b);
    const bBefore = await t.expected(b);
    await t.put(bBefore.epub);
    await t.put(bBefore.kepub);
    const bMoved = makeBook(ID_B, { title: "Altro", topic: "saggistica" });
    await writeBook(t.env.dataDir, bMoved);
    const orphan = `Rakuten Kobo/Filosofia/Orfano [${ID_ORPHAN}].kepub.epub`;
    await t.put(orphan);

    const snap = await t.snapshot();
    const planned = await reconcile(t.ctx, "all", { dryRun: true, prune: true });
    expect(await t.snapshot()).toEqual(snap);
    expect(planned.dryRun).toBe(true);
    expect(planned.errors).toEqual([]);
    expect(new Set(planned.actions.map((x) => x.status))).toEqual(new Set(["planned"]));
    expect(planned.actions.map((x) => x.type)).toEqual([
      "move",
      "move",
      "upload",
      "upload",
      "trash",
      "rmdir",
    ]);

    // A dry-run context stays dry even if a call asks otherwise.
    const dryCtx = createDriveContext(t.config, { env: t.env.env, dryRun: true });
    const forced = await reconcile(dryCtx, "all", { dryRun: false, prune: true });
    expect(forced.dryRun).toBe(true);
    expect(await t.snapshot()).toEqual(snap);

    // The real run does exactly what was planned.
    const done = await reconcile(t.ctx, "all", { prune: true });
    expect(done.errors).toEqual([]);
    expect(summary(done)).toEqual(summary(planned).map((s) => s.replace(":planned:", ":done:")));
    expect(await reconcile(t.ctx, "all", { prune: true })).toEqual(noop);
  });

  it("reports a book with nothing to upload and goes on with the others", async () => {
    await t.addBook(makeBook(ID_A));
    const b = makeBook(ID_B);
    await t.addBook(b, { epub: "EPUB-B", kepub: "KEPUB-B" });

    const report = await reconcile(t.ctx, [ID_A, ID_B, "not-an-id", ID_ORPHAN]);
    expect(report.actions.map((a) => [a.type, a.status, a.bookId])).toEqual([
      ["upload", "done", ID_B],
      ["upload", "done", ID_B],
    ]);
    expect(report.errors.map((e) => [e.code, e.bookId])).toEqual([
      ["invalid-book-id", undefined],
      ["book-not-found", ID_ORPHAN],
      ["missing-in-cache", ID_A],
      ["missing-in-cache", ID_A],
    ]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "a failed action is reported and does not stop the run",
    async () => {
      const a = makeBook(ID_A);
      await t.addBook(a, { epub: "EPUB-A", kepub: "KEPUB-A" });
      await chmod(cachedEpubPath(t.env.cacheDir, ID_A), 0o000);
      const b = makeBook(ID_B);
      await t.addBook(b, { epub: "EPUB-B", kepub: "KEPUB-B" });

      const report = await reconcile(t.ctx, [ID_A, ID_B]);
      await chmod(cachedEpubPath(t.env.cacheDir, ID_A), 0o644);
      expect(report.actions.map((x) => [x.bookId, x.tree, x.status])).toEqual([
        [ID_A, "archive", "failed"],
        [ID_A, "kobo", "done"],
        [ID_B, "archive", "done"],
        [ID_B, "kobo", "done"],
      ]);
      expect(report.errors.map((e) => [e.code, e.bookId])).toEqual([["rclone-failed", ID_A]]);

      // Re-running finishes the job.
      const retry = await reconcile(t.ctx, [ID_A, ID_B]);
      expect(retry.errors).toEqual([]);
      expect(summary(retry)).toEqual([
        `upload:done:${cachedEpubPath(t.env.cacheDir, ID_A)}->${(await t.expected(a)).epub}`,
      ]);
    },
  );

  it("leaves the files of a book with an unknown topic alone, even with prune", async () => {
    const book = makeBook(ID_A, { topic: "storia" });
    await t.addBook(book);
    const stray = `Archivio/Narrativa/Qualcosa [${ID_A}].epub`;
    await t.put(stray);
    const report = await reconcile(t.ctx, "all", { prune: true });
    expect(report.actions).toEqual([]);
    expect(codes(report.errors)).toEqual(["unknown-topic"]);
    expect(await t.remoteFiles()).toEqual([stray]);
  });

  it("reconcileBooks uploads a book that has no book.json yet (upload flow)", async () => {
    const book = makeBook(ID_C);
    await mkdir(path.dirname(cachedEpubPath(t.env.cacheDir, ID_C)), { recursive: true });
    await writeFile(cachedEpubPath(t.env.cacheDir, ID_C), "EPUB-C");
    await writeFile(cachedKepubPath(t.env.cacheDir, ID_C), "KEPUB-C");
    const report = await reconcileBooks(t.ctx, [book]);
    expect(report.errors).toEqual([]);
    expect(report.actions.map((a) => [a.type, a.status])).toEqual([
      ["upload", "done"],
      ["upload", "done"],
    ]);
    expect(await t.remoteFiles()).toHaveLength(2);
  });
});

describe.skipIf(!hasBinary("rclone"))("reconcile with a flat Kobo tree", () => {
  let t: DriveTestEnv;
  beforeEach(async () => {
    t = await setupDrive({ drive: { topicSubfolders: { kobo: false, archive: true } } });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("uploads the KEPUB to the tree root and flattens old topic folders", async () => {
    const a = makeBook(ID_A);
    await t.addBook(a, { epub: "EPUB-A", kepub: "KEPUB-A" });
    const expA = await t.expected(a);
    expect(expA.kepub).toBe(`Rakuten Kobo/${driveFileName(a, "kepub")}`);
    expect(expA.epub).toBe(`Archivio/Narrativa/${driveFileName(a, "epub")}`);

    const b = makeBook(ID_B, { title: "Altro" });
    await t.addBook(b);
    const expB = await t.expected(b);
    const nested = `Rakuten Kobo/Narrativa/${driveFileName(b, "kepub")}`;
    await t.put(nested);
    await t.put(expB.epub);

    const report = await reconcile(t.ctx, "all");
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual([
      `move:done:${nested}->${expB.kepub}`,
      `upload:done:${cachedEpubPath(t.env.cacheDir, ID_A)}->${expA.epub}`,
      `upload:done:${cachedKepubPath(t.env.cacheDir, ID_A)}->${expA.kepub}`,
      "rmdir:done:Rakuten Kobo/Narrativa->",
    ]);
    expect(await t.remoteDirs()).toEqual(["Archivio", "Archivio/Narrativa", "Rakuten Kobo"]);
    expect(await reconcile(t.ctx, "all")).toEqual(noop);
  });
});
