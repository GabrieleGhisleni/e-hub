/** R1-02, R1-03, R1-05, R1-10: prune guard, import resume / orphans, staging cleanup, cross-process lock. */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath, isNonEmptyFile } from "../../../src/node/cache/index.ts";
import { type CliIO, runCli } from "../../../src/node/cli/program.ts";
import { readAllBooks } from "../../../src/node/repo/index.ts";
import {
  LOCK_FILE_NAME,
  LockBusyError,
  analyzeUpload,
  cleanupStaleUploads,
  createBook,
  deleteBook,
  importFolder,
  updateBook,
} from "../../../src/node/services/index.ts";
import type { NewBook } from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub, makeEpub } from "../../helpers/epub.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";
import {
  type ServicesTestEnv,
  failingKepubRclone,
  offlineFetch,
  setupServices,
  whichBinary,
} from "./setup.ts";

const NEW_BOOK: NewBook = {
  title: "Il giardino delle prove",
  authors: ["Ada Esempio"],
  topic: "narrativa",
  status: "to-read",
};

async function elib(t: ServicesTestEnv, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: (s) => void (stdout += s),
    stderr: (s) => void (stderr += s),
    env: t.env.env,
    fetch: offlineFetch,
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

describe.skipIf(!hasBinary("rclone") || !hasBinary("kepubify"))("hardening (R1)", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function createOne(title = NEW_BOOK.title) {
    const epub = await buildEpub({ title });
    const analysis = await analyzeUpload(t.ctx, { fileName: "libro.epub", bytes: epub });
    const { book } = await createBook(t.ctx, {
      uploadId: analysis.uploadId,
      book: { ...NEW_BOOK, title },
      cover: "epub",
    });
    return book;
  }

  describe("R1-02: sync --prune guard", () => {
    it("refuses a real prune on an empty data dir, trashes nothing, --dry-run still works", async () => {
      await createOne();
      await createOne("Secondo libro");
      expect(await t.remoteFiles()).toHaveLength(4);
      // Wrong data dir: the same config, but a data dir without books (e.g. a stale ELIB_DATA_DIR).
      const empty = await makeTempDir("elib-empty-data-");
      try {
        await copyFile(
          path.join(t.env.dataDir, "topics.json"),
          path.join(empty.dir, "topics.json"),
        );
        const wrong = { ...t, env: { ...t.env, env: { ...t.env.env, ELIB_DATA_DIR: empty.dir } } };
        const run = await elib(wrong, "sync", "--prune");
        expect(run.code).toBe(1);
        expect(run.stderr).toContain(`Data dir: ${empty.dir} (0 book(s))`);
        expect(run.stderr).toContain("--prune refused");
        expect(run.stderr).toContain("--dry-run");
        expect(await t.remoteFiles()).toHaveLength(4);

        const dry = await elib(wrong, "sync", "--prune", "--dry-run");
        expect(dry.stderr).toContain("Data dir:");
        expect(dry.stdout).toContain("To the Drive trash (4)");
        expect(await t.remoteFiles()).toHaveLength(4);
      } finally {
        await empty.cleanup();
      }
    });

    it("refuses more than 10 files, allows them with --force; a few orphans pass", async () => {
      await createOne();
      await createOne("Secondo libro");
      await createOne("Terzo libro");
      await createOne("Quarto libro");
      await createOne("Quinto libro");
      await createOne("Sesto libro");
      // Hide every book from the CLI: 12 files look like orphans but the data dir is not empty.
      await createOne("Settimo libro");
      const books = (await readAllBooks(t.env.dataDir)).books;
      expect(books).toHaveLength(7);
      for (const b of books.slice(0, 6))
        await rm(path.join(t.env.dataDir, "books", b.id), { recursive: true });
      const refused = await elib(t, "sync", "--prune");
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("--prune refused");
      expect(await t.remoteFiles()).toHaveLength(14);

      const forced = await elib(t, "sync", "--prune", "--force");
      expect(forced.code).toBe(0);
      expect(await t.remoteFiles()).toHaveLength(2);
    });

    it("lets a small prune through", async () => {
      await createOne();
      await createOne("Secondo libro");
      await createOne("Terzo libro");
      await createOne("Quarto libro");
      await createOne("Quinto libro");
      await mkdir(t.env.remote.localPath("Archivio/Varie"), { recursive: true });
      await writeFile(t.env.remote.localPath("Archivio/Varie/Altro [zzzz0000].epub"), "x");
      const run = await elib(t, "sync", "--prune");
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("To the Drive trash (1)");
      expect(await t.remoteFiles()).toHaveLength(10);
    });
  });

  describe("R1-03: import after a partial failure", () => {
    let src: TempDir;
    beforeEach(async () => {
      src = await makeTempDir("elib-import-src-");
      await makeEpub({ outPath: path.join(src.dir, "a.epub") });
    });
    afterEach(async () => {
      await src.cleanup();
    });

    it("a rerun resumes the failed import with the same book ID", async () => {
      const failing = t.makeCtx({
        rcloneBinary: await failingKepubRclone(src.dir, whichBinary("rclone")),
      });
      const first = await importFolder(failing, src.dir);
      expect(first.items.map((i) => i.status)).toEqual(["failed"]);
      expect((await readAllBooks(t.env.dataDir)).books).toEqual([]);
      const orphans = await t.remoteFiles();
      expect(orphans).toHaveLength(1); // the EPUB reached Drive, the KEPUB did not
      const orphanId = /\[([0-9a-z]{8})\]\.epub$/.exec(orphans[0]!)![1]!;

      const second = await importFolder(t.ctx, src.dir);
      expect(second.items.map((i) => i.status)).toEqual(["imported"]);
      expect(second.items[0]!.bookId).toBe(orphanId);
      expect(await t.remoteFiles()).toHaveLength(2);
      expect((await readAllBooks(t.env.dataDir)).books.map((b) => b.id)).toEqual([orphanId]);
    });

    it("an orphan copy on Drive (no book in the repo, no staging) is not a duplicate", async () => {
      const failing = t.makeCtx({
        rcloneBinary: await failingKepubRclone(src.dir, whichBinary("rclone")),
      });
      await importFolder(failing, src.dir);
      // The staging is gone (e.g. the 24h cleanup, or another cache): only the orphan EPUB is left.
      const { cleanupStaleUploads: clean } = await import("../../../src/node/services/index.ts");
      const later = t.makeCtx({ now: () => new Date(Date.now() + 48 * 3600 * 1000) });
      expect(await clean(later)).toBe(1);

      const dry = await importFolder(t.ctx, src.dir, { dryRun: true });
      expect(dry.items[0]!.status).toBe("ready");
      expect(dry.items[0]!.warnings.join(" ")).toContain("copia orfana");

      const real = await importFolder(t.ctx, src.dir);
      expect(real.items.map((i) => i.status)).toEqual(["imported"]);
      expect((await readAllBooks(t.env.dataDir)).books).toHaveLength(1);

      // The upload form's duplicate list ignores orphans too, but keeps real books.
      const bytes = new Uint8Array(
        await (await import("node:fs/promises")).readFile(path.join(src.dir, "a.epub")),
      );
      const analysis = await analyzeUpload(t.ctx, { fileName: "a.epub", bytes });
      expect(analysis.duplicates.map((d) => d.kind)).toContain("md5");
    });

    it("analyzeUpload: an orphan MD5 match is dropped with a warning", async () => {
      await mkdir(t.env.remote.localPath("Archivio/Varie"), { recursive: true });
      const file = path.join(src.dir, "a.epub");
      await copyFile(file, t.env.remote.localPath("Archivio/Varie/Orfano [zzzz0000].epub"));
      await copyFile(file, t.env.remote.localPath("Archivio/Varie/senza id.epub"));
      const bytes = new Uint8Array(await (await import("node:fs/promises")).readFile(file));
      const analysis = await analyzeUpload(t.ctx, { fileName: "a.epub", bytes });
      expect(analysis.duplicates.filter((d) => d.kind === "md5")).toEqual([]);
      expect(analysis.warnings.filter((w) => w.includes("copia orfana"))).toHaveLength(2);
    });
  });

  it("R1-05: cleanupStaleUploads keeps the cache of a created-then-deleted book", async () => {
    const book = await createOne();
    await deleteBook(t.ctx, book.id);
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    const later = t.makeCtx({ now: () => new Date(Date.now() + 48 * 3600 * 1000) });
    expect(await cleanupStaleUploads(later)).toBe(1);
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    expect(await readdir(path.join(t.env.cacheDir, "uploads"))).toEqual([]);
  });

  it("R1-04: a zip bomb upload is a 400 not-an-epub", async () => {
    const { zipSync } = await import("fflate");
    const bomb = zipSync({
      "META-INF/container.xml": [new Uint8Array(20 * 1024 * 1024), { level: 9 }],
    });
    const error = await analyzeUpload(t.ctx, { fileName: "bomba.epub", bytes: bomb }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 400, code: "not-an-epub" });
  });

  describe("R1-10: cross-process lock", () => {
    it("a write fails fast while another live process holds the lock", async () => {
      const book = await createOne();
      const lockFile = path.join(t.env.cacheDir, LOCK_FILE_NAME);
      // PID 1 is alive and is not us.
      await writeFile(lockFile, JSON.stringify({ pid: 1, startedAt: "2026-01-01T00:00:00Z" }));
      const error = await updateBook(t.ctx, book.id, { status: "read" }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(LockBusyError);
      expect(error).toMatchObject({ status: 409, code: "busy" });
      await expect(isNonEmptyFile(lockFile)).resolves.toBe(true); // not ours: left alone
      // The CLI refuses too.
      const run = await elib(t, "sync");
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("Un altro processo elib");
    });

    it("a stale lock (dead PID) is reclaimed, and the lock is released after the run", async () => {
      const book = await createOne();
      const lockFile = path.join(t.env.cacheDir, LOCK_FILE_NAME);
      await writeFile(
        lockFile,
        JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: "2020-01-01T00:00:00Z" }),
      );
      const { book: updated } = await updateBook(t.ctx, book.id, { status: "read" });
      expect(updated.status).toBe("read");
      expect(await isNonEmptyFile(lockFile)).toBe(false);
      expect((await elib(t, "sync")).code).toBe(0);
      expect(await isNonEmptyFile(lockFile)).toBe(false);
    });
  });
});
