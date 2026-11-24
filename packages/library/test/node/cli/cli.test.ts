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
    // The test folders on top of the real env: kepubify still needs PATH.
    env: { ...process.env, ...t.env.env },
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
/** The KEPUB and its KOReader sidecar metadata, as the CLI names them on the Kobo. */
const BOOK_KEPUB = "Ada Esempio - Il giardino delle prove [7k2m9q4t].kepub.epub";
const BOOK_METADATA =
  "Ada Esempio - Il giardino delle prove [7k2m9q4t].kepub.sdr/custom_metadata.lua";
/** Not in the repo: an orphan (valid ID, no folder in data/books). */
const ORPHAN = "Ignoto - Altro [zzzz0000].kepub.epub";
/** Copied by hand onto the Kobo: not ours, never touched. */
const UNMANAGED = "Clear, James - Atomic habits.kepub.epub";

describe("elib CLI", () => {
  let t: ServicesTestEnv;
  /** Every file under the Kobo folder, sorted, "/"-separated. */
  const koboFiles = async (): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), name);
        else out.push(name);
      }
    };
    await walk(t.env.koboDir, "");
    return out.sort();
  };
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("--help lists the commands; unknown commands fail", async () => {
    const help = await elib(t, "--help");
    expect(help.code).toBe(0);
    for (const name of ["sync", "import", "summarize"]) expect(help.stdout).toContain(name);
    expect((await elib(t, "nope")).code).not.toBe(0);
  });

  it("sync mirrors the repo onto the Kobo; --prune deletes orphans only; exit 1 on errors", async () => {
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
    expect(run.stdout).toContain("Uploaded to the Kobo (1)");
    expect(run.stdout).toContain("Series metadata written (1)");
    expect(run.stdout).toContain("[planned]");
    expect(run.stdout).toContain("2 action(s) planned");
    expect(await koboFiles()).toEqual([]);

    run = await elib(t, "sync", "--dry-run", "--json");
    const report = JSON.parse(run.stdout) as ReconcileReport;
    expect(report.dryRun).toBe(true);
    expect(report.actions.map((a) => a.type)).toEqual(["upload", "metadata"]);

    run = await elib(t, "sync");
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("Kobo: ");
    expect(run.stdout).toContain("2 action(s) done");
    expect(await koboFiles()).toEqual([BOOK_KEPUB, BOOK_METADATA].sort());
    expect(await elib(t, "sync").then((r) => r.stdout)).toContain("nothing to do");

    // An orphan on the Kobo: reported, deleted only with --prune.
    await writeFile(path.join(t.env.koboDir, ORPHAN), "x");
    run = await elib(t, "sync", "--dry-run", "--prune");
    expect(run.stderr).toContain("--prune (dry run)");
    expect(run.stdout).toContain("Deleted from the Kobo (1)");
    expect(await koboFiles()).toHaveLength(3);
    run = await elib(t, "sync");
    expect(run.stdout).toContain("orphan-file");
    expect(await koboFiles()).toHaveLength(3);
    run = await elib(t, "sync", "--prune");
    expect(run.stderr).toContain("there is no trash");
    expect(run.stdout).toContain("Deleted from the Kobo (1)");
    expect(await koboFiles()).toEqual([BOOK_KEPUB, BOOK_METADATA].sort());

    // A file that is not ours is never deleted, not even with --prune --force.
    await writeFile(path.join(t.env.koboDir, UNMANAGED), "x");
    run = await elib(t, "sync", "--prune", "--force");
    expect(run.code).toBe(0);
    expect(await koboFiles()).toEqual([BOOK_KEPUB, BOOK_METADATA, UNMANAGED].sort());

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
      expect(await koboFiles()).toEqual([]);

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
        // Two KEPUBs and two sidecar metadata files, flat on the Kobo.
        const files = await koboFiles();
        expect(files).toHaveLength(4);
        expect(
          files.every((f) => /\[[0-9a-z]{8}\]\.kepub\.(epub|sdr\/custom_metadata\.lua)$/.test(f)),
        ).toBe(true);

        run = await elib(t, "import", src.dir);
        expect(run.stdout).toContain("Imported 0, 3 duplicate(s) skipped");
        expect((await readAllBooks(t.env.dataDir)).books).toHaveLength(2);
      },
    );
  });
});
