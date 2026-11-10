import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import { type CliIO, runCli } from "../../../src/node/cli/program.ts";
import { readAllBooks, writeBook } from "../../../src/node/repo/index.ts";
import type { ImportResult } from "../../../src/node/services/index.ts";
import type { ReconcileReport } from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { makeEpub } from "../../helpers/epub.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";
import { type ServicesTestEnv, offlineFetch, setupServices } from "../services/setup.ts";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function elib(t: ServicesTestEnv, ...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    env: t.env.env,
    fetch: offlineFetch,
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

const BOOK = {
  id: "7k2m9q4t",
  title: "Il giardino delle prove",
  authors: ["Ada Esempio"],
  topic: "narrativa",
  status: "to-read" as const,
};

describe.skipIf(!hasBinary("rclone"))("elib CLI", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("--help lists the commands; unknown commands fail", async () => {
    const help = await elib(t, "--help");
    expect(help.code).toBe(0);
    for (const name of ["sync", "import", "validate"]) expect(help.stdout).toContain(name);
    expect((await elib(t, "nope")).code).not.toBe(0);
  });

  it("validate: exit 0 on valid data, 1 with an invalid book", async () => {
    let run = await elib(t, "validate");
    expect(run).toMatchObject({ code: 0 });
    expect(run.stdout).toContain("0 error(s), 0 warning(s)");
    await mkdir(path.join(t.env.dataDir, "books", BOOK.id), { recursive: true });
    await writeFile(
      path.join(t.env.dataDir, "books", BOOK.id, "book.json"),
      JSON.stringify({ ...BOOK, topic: "inesistente" }),
    );
    run = await elib(t, "validate");
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/error: .*inesistente/);
    const json = await elib(t, "validate", "--json");
    expect(JSON.parse(json.stdout).errors.length).toBeGreaterThan(0);
  });

  it("sync --dry-run plans uploads without writing; sync uploads; --prune notice; exit 1 on errors", async () => {
    await writeBook(t.env.dataDir, BOOK);
    for (const file of [
      cachedEpubPath(t.env.cacheDir, BOOK.id),
      cachedKepubPath(t.env.cacheDir, BOOK.id),
    ]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `bytes of ${path.basename(file)}`);
    }

    let run = await elib(t, "sync", "--dry-run");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Dry run: nothing was changed");
    expect(run.stdout).toContain("Uploads (2)");
    expect(run.stdout).toContain("[planned]");
    expect(run.stdout).toContain("2 action(s) planned");
    expect(await t.remoteFiles()).toEqual([]);

    run = await elib(t, "sync", "--dry-run", "--json");
    const report = JSON.parse(run.stdout) as ReconcileReport;
    expect(report.dryRun).toBe(true);
    expect(report.actions.map((a) => a.type)).toEqual(["upload", "upload"]);

    run = await elib(t, "sync");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("2 action(s) done");
    expect(await t.remoteFiles()).toHaveLength(2);

    // An orphan on Drive: reported, trashed only with --prune.
    await mkdir(t.env.remote.localPath("Archivio/Varie"), { recursive: true });
    await writeFile(t.env.remote.localPath("Archivio/Varie/Altro [zzzz0000].epub"), "x");
    run = await elib(t, "sync", "--dry-run", "--prune");
    expect(run.stderr).toContain("--prune (dry run)");
    expect(run.stdout).toContain("To the Drive trash (1)");
    run = await elib(t, "sync");
    expect(run.stdout).toContain("orphan-file");
    expect(await t.remoteFiles()).toHaveLength(3);

    // A book with nothing to upload: error, exit 1.
    await writeBook(t.env.dataDir, { ...BOOK, id: "a1b2c3d4" });
    run = await elib(t, "sync");
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("missing-in-cache");
  });

  describe("import", () => {
    let src: TempDir;
    beforeEach(async () => {
      src = await makeTempDir("elib-import-src-");
      await makeEpub({ outPath: path.join(src.dir, "a.epub") });
      await mkdir(path.join(src.dir, "sub"), { recursive: true });
      await makeEpub({
        outPath: path.join(src.dir, "sub", "b.epub"),
        title: "Senza copertina",
        creators: [],
        isbn: null,
        cover: false,
      });
      await copyFile(path.join(src.dir, "a.epub"), path.join(src.dir, "sub", "copia.epub"));
      await makeEpub({ outPath: path.join(src.dir, "d.kepub.epub") });
      await writeFile(path.join(src.dir, "rotto.epub"), "not a zip");
      await writeFile(path.join(src.dir, "note.txt"), "ignored");
    });
    afterEach(async () => {
      await src.cleanup();
    });

    it("--dry-run extracts and checks duplicates, writes nothing", async () => {
      const run = await elib(t, "import", src.dir, "--dry-run");
      expect(run.code).toBe(0);
      expect(run.stdout).toMatch(/#\s+file\s+title/);
      expect(run.stdout).toContain("Il giardino delle prove");
      expect(run.stdout).toContain("same file as a.epub");
      expect(run.stdout).toContain("skipped 1 *.kepub.epub");
      expect(run.stdout).toContain(
        "Dry run: 2 would be imported, 1 duplicate(s) skipped, 1 invalid",
      );
      expect(run.stdout).toMatch(/Missing among 3 readable: author 1, ISBN 1, cover 1/);
      expect((await readAllBooks(t.env.dataDir)).books).toEqual([]);
      expect(await readdir(t.env.cacheDir)).toEqual([]);
      expect(await t.remoteFiles()).toEqual([]);

      const json = JSON.parse(
        (await elib(t, "import", src.dir, "--dry-run", "--json")).stdout,
      ) as ImportResult;
      expect(
        json.items.map((i) => [path.relative(src.dir, i.file), i.status, i.cover ?? null]),
      ).toEqual([
        ["a.epub", "ready", "epub"],
        ["rotto.epub", "invalid", null],
        ["sub/b.epub", "ready", "placeholder"],
        ["sub/copia.epub", "duplicate", null],
      ]);
      const limited = JSON.parse(
        (await elib(t, "import", src.dir, "--dry-run", "--json", "--limit", "1")).stdout,
      ) as ImportResult;
      expect([limited.items.length, limited.notProcessed]).toEqual([1, 3]);
      expect((await elib(t, "import", src.dir, "--limit", "0")).code).not.toBe(0);
    });

    it.skipIf(!hasBinary("kepubify"))(
      "a real run creates books in Da smistare; a second run skips them as duplicates",
      async () => {
        let run = await elib(t, "import", src.dir);
        expect(run.code).toBe(0);
        expect(run.stdout).toContain("Imported 2, 1 duplicate(s) skipped, 1 invalid, 0 failed.");
        const { books } = await readAllBooks(t.env.dataDir);
        expect(books.map((b) => [b.title, b.authors, b.topic, b.status]).sort()).toEqual([
          ["Il giardino delle prove", ["Ada Esempio", "Bruno Campione"], "unsorted", "to-read"],
          ["Senza copertina", ["Autore sconosciuto"], "unsorted", "to-read"],
        ]);
        expect(await t.remoteFiles()).toHaveLength(4);
        expect((await t.remoteFiles()).every((f) => f.split("/")[1] === "Da smistare")).toBe(true);

        run = await elib(t, "import", src.dir);
        expect(run.stdout).toContain("Imported 0, 3 duplicate(s) skipped");
        expect((await readAllBooks(t.env.dataDir)).books).toHaveLength(2);
      },
    );
  });
});
