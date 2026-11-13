import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import {
  type KoboContext,
  createKoboContext,
  localTransport,
  reconcile,
  reconcileBooks,
  removeBookFiles,
  sidecarContent,
  sidecarMetadataPath,
} from "../../../src/node/kobo/index.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import { emptyReconcileReport } from "../../../src/shared/api.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { type TestEnv, createTestEnv } from "../../helpers/test-env.ts";

const ID_A = "7k2m9q4t";
const ID_B = "a1b2c3d4";
const ID_ORPHAN = "zzzz0000";
const ID_INCOMPLETE = "qqqq1111";
const LABEL_NARRATIVA = "Narrativa";
const CLEAR = "Clear, James - Atomic habits.kepub.epub";

function makeBook(id: string, extra: Partial<Book> = {}): Book {
  return {
    id,
    title: "Il giardino delle prove",
    authors: ["Ada Esempio"],
    topic: "narrativa",
    status: "to-read",
    ...extra,
  };
}

interface KoboSetup {
  env: TestEnv;
  kobo: { host: string; port: number; identityFile: string; booksDir: string };
  ctx: KoboContext;
  addBook(
    book: Book,
    cache?: { epub?: string | Uint8Array; kepub?: string | Uint8Array },
  ): Promise<void>;
  /** Writes a file under the Kobo folder (creating folders). */
  put(relPath: string, content: string): Promise<void>;
  /** Content of a file under the Kobo folder, or null. */
  read(relPath: string): Promise<string | null>;
  /** Every file under the Kobo folder, sorted, "/"-separated. */
  files(): Promise<string[]>;
  cleanup(): Promise<void>;
}

async function setupKobo(): Promise<KoboSetup> {
  const env = await createTestEnv();
  const kobo = {
    host: "root@127.0.0.1",
    port: 2222,
    identityFile: path.join(path.dirname(env.koboDir), "no-key"),
    booksDir: "/mnt/onboard/books",
  };
  const ctx = createKoboContext(
    { kobo, dataDir: env.dataDir, cache: { dir: env.cacheDir } },
    { transport: localTransport(env.koboDir) },
  );
  const local = (relPath: string): string => path.join(env.koboDir, ...relPath.split("/"));
  return {
    env,
    kobo,
    ctx,
    async addBook(book, cache = {}) {
      await writeBook(env.dataDir, book);
      if (cache.epub !== undefined) {
        const file = cachedEpubPath(env.cacheDir, book.id);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cache.epub);
      }
      if (cache.kepub !== undefined) {
        const file = cachedKepubPath(env.cacheDir, book.id);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cache.kepub);
      }
    },
    async put(relPath, content) {
      await mkdir(path.dirname(local(relPath)), { recursive: true });
      await writeFile(local(relPath), content);
    },
    async read(relPath) {
      try {
        return await readFile(local(relPath), "utf8");
      } catch {
        return null;
      }
    },
    async files() {
      const out: string[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
          else out.push(rel);
        }
      };
      await walk(env.koboDir, "");
      return out.sort();
    },
    cleanup: env.cleanup,
  };
}

const kinds = (actions: { type: string; status: string }[]): string[] =>
  actions.map((a) => `${a.type}:${a.status}`);

describe("kobo reconcile on a local folder", () => {
  let t: KoboSetup;
  beforeEach(async () => {
    t = await setupKobo();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("uploads the missing KEPUB and writes the sidecar metadata; a second run plans nothing", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { kepub: "KEPUB-A" });

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(kinds(report.actions)).toEqual(["upload:done", "metadata:done"]);
    expect(report.actions[0]).toEqual({
      type: "upload",
      status: "done",
      bookId: ID_A,
      from: cachedKepubPath(t.env.cacheDir, ID_A),
      to: koboFileName(book, "kepub"),
    });
    expect(await t.read(koboFileName(book, "kepub"))).toBe("KEPUB-A");
    expect(await t.read(sidecarMetadataPath(book))).toBe(sidecarContent(book, LABEL_NARRATIVA));

    expect(await reconcile(t.ctx, [ID_A])).toEqual(emptyReconcileReport());
    expect(await reconcile(t.ctx, "all")).toEqual(emptyReconcileReport());
    expect(await t.files()).toEqual(
      [sidecarMetadataPath(book), koboFileName(book, "kepub")].sort(),
    );
  });

  it("renames the KEPUB and its sidecar folder on a title change, keeps reading progress", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { kepub: "KEPUB-A" });
    await reconcile(t.ctx, [ID_A]);
    const oldKepub = koboFileName(book, "kepub");
    const oldSidecar = koboFileName(book, "sidecar");
    await t.put(`${oldSidecar}/metadata.epub.lua`, "return { progress = 42 }\n");

    const renamed = makeBook(ID_A, { title: "Titolo nuovo" });
    await writeBook(t.env.dataDir, renamed);
    const report = await reconcile(t.ctx, [ID_A]);

    expect(report.errors).toEqual([]);
    expect(kinds(report.actions)).toEqual(["rename:done", "rename:done", "metadata:done"]);
    expect(await t.read(koboFileName(renamed, "kepub"))).toBe("KEPUB-A");
    expect(await t.read(oldKepub)).toBeNull();
    expect(await t.read(`${koboFileName(renamed, "sidecar")}/metadata.epub.lua`)).toBe(
      "return { progress = 42 }\n",
    );
    expect(await t.read(oldSidecar + "/metadata.epub.lua")).toBeNull();
    expect(await t.read(sidecarMetadataPath(renamed))).toBe(
      sidecarContent(renamed, LABEL_NARRATIVA),
    );
    expect(await reconcile(t.ctx, [ID_A])).toEqual(emptyReconcileReport());
  });

  it("a topic change only rewrites the metadata (the file names do not contain the topic)", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { kepub: "KEPUB-A" });
    await reconcile(t.ctx, [ID_A]);

    const moved = makeBook(ID_A, { topic: "filosofia" });
    await writeBook(t.env.dataDir, moved);
    const report = await reconcile(t.ctx, [ID_A]);

    expect(kinds(report.actions)).toEqual(["metadata:done"]);
    expect(report.actions[0]?.to).toBe(sidecarMetadataPath(moved));
    expect(await t.read(sidecarMetadataPath(moved))).toContain('["series"] = "Filosofia"');
    expect(await t.read(koboFileName(moved, "kepub"))).toBe("KEPUB-A");
  });

  it("a dry run plans everything and writes nothing", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { kepub: "KEPUB-A" });

    const report = await reconcile(t.ctx, [ID_A], { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.errors).toEqual([]);
    expect(kinds(report.actions)).toEqual(["upload:planned", "metadata:planned"]);
    expect(await t.files()).toEqual([]);
  });

  it("a dry run regenerates nothing: the KEPUB is only planned from the cached EPUB", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { epub: "EPUB-A" });

    const report = await reconcile(t.ctx, [ID_A], { dryRun: true });
    expect(report.warnings.map((w) => w.code)).toEqual(["kepub-regenerated"]);
    expect(kinds(report.actions)).toEqual(["upload:planned", "metadata:planned"]);
    expect(await t.files()).toEqual([]);
  });

  describe.skipIf(!hasBinary("kepubify"))("with kepubify", () => {
    it("regenerates a missing KEPUB from the cached EPUB, then uploads it", async () => {
      const book = makeBook(ID_A);
      const epub = await buildEpub({ title: book.title, creators: ["Ada Esempio"] });
      await t.addBook(book, { epub });

      const report = await reconcile(t.ctx, [ID_A]);
      expect(report.errors).toEqual([]);
      expect(report.warnings.map((w) => w.code)).toEqual(["kepub-regenerated"]);
      const bytes = await readFile(path.join(t.env.koboDir, koboFileName(book, "kepub")));
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    });
  });

  it("reports a book with no copy in the cache, and still reconciles the others", async () => {
    await t.addBook(makeBook(ID_A), { kepub: "KEPUB-A" });
    await t.addBook(makeBook(ID_B, { title: "Altro" }));

    const report = await reconcile(t.ctx, [ID_A, ID_B]);
    expect(report.errors.map((e) => [e.code, e.bookId])).toEqual([["missing-in-cache", ID_B]]);
    expect(report.actions.every((a) => a.bookId === ID_A)).toBe(true);
    expect(kinds(report.actions)).toEqual(["upload:done", "metadata:done"]);
  });

  it("keeps the first sorted extra KEPUB copy's name, renames it, and reports the others", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book);
    const vecchio = `Ada Esempio - Vecchio [${ID_A}].kepub.epub`;
    const altro = `Ada Esempio - Altro [${ID_A}].kepub.epub`;
    await t.put(vecchio, "OLD");
    await t.put(altro, "OTHER");

    const report = await reconcile(t.ctx, [ID_A]);
    expect(report.actions.filter((a) => a.type === "rename").map((a) => [a.from, a.to])).toEqual([
      [altro, koboFileName(book, "kepub")],
    ]);
    expect(report.warnings.map((w) => [w.code, w.path])).toEqual([["duplicate-file", vecchio]]);
    expect(await t.read(vecchio)).toBe("OLD");
  });

  it("reports unknown topics per book and writes nothing for them", async () => {
    const report = await reconcileBooks(t.ctx, [makeBook(ID_A, { topic: "nope" })]);
    expect(report.errors.map((e) => e.code)).toEqual(["unknown-topic"]);
    expect(report.actions).toEqual([]);
    expect(await t.files()).toEqual([]);
  });

  it("reports unknown and missing books without touching the Kobo", async () => {
    const report = await reconcile(t.ctx, ["not-an-id", ID_ORPHAN]);
    expect(report.errors.map((e) => e.code).sort()).toEqual(["book-not-found", "invalid-book-id"]);
    expect(report.actions).toEqual([]);
  });

  it("reports orphans and removes them only with prune", async () => {
    const orphanKepub = `Ada Esempio - Vecchio [${ID_ORPHAN}].kepub.epub`;
    const orphanSidecar = `Ada Esempio - Vecchio [${ID_ORPHAN}].kepub.sdr`;
    await t.put(orphanKepub, "OLD");
    await t.put(`${orphanSidecar}/custom_metadata.lua`, "x");

    const report = await reconcile(t.ctx, "all");
    expect(report.actions).toEqual([]);
    expect(report.warnings.map((w) => [w.code, w.path])).toEqual([
      ["orphan-file", orphanKepub],
      ["orphan-file", orphanSidecar],
    ]);
    expect(await t.files()).toHaveLength(2);

    const pruned = await reconcile(t.ctx, "all", { prune: true });
    expect(kinds(pruned.actions)).toEqual(["remove:done", "remove:done"]);
    expect(await t.files()).toEqual([]);
  });

  it("never removes an incomplete upload, even with prune", async () => {
    await mkdir(path.join(t.env.dataDir, "books", ID_INCOMPLETE), { recursive: true });
    const name = `Ada Esempio - Incompleto [${ID_INCOMPLETE}].kepub.epub`;
    await t.put(name, "PARTIAL");

    const report = await reconcile(t.ctx, "all", { prune: true });
    expect(report.actions).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual(["incomplete-upload"]);
    expect(await t.read(name)).toBe("PARTIAL");
  });

  it("never touches the unmanaged Clear, James file, even with prune", async () => {
    await t.put(CLEAR, "CLEAR");
    await t.put(`Clear, James - Atomic habits.kepub.sdr/metadata.epub.lua`, "x");

    const report = await reconcile(t.ctx, "all", { prune: true });
    expect(report.actions).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(await t.read(CLEAR)).toBe("CLEAR");
    expect(await t.read("Clear, James - Atomic habits.kepub.sdr/metadata.epub.lua")).toBe("x");
  });

  it("removes both files of a deleted book, and says so when there are none", async () => {
    const book = makeBook(ID_A);
    await t.addBook(book, { kepub: "KEPUB-A" });
    await reconcile(t.ctx, [ID_A]);

    const report = await removeBookFiles(t.ctx, ID_A);
    expect(kinds(report.actions)).toEqual(["remove:done", "remove:done"]);
    expect(report.warnings).toEqual([]);
    expect(await t.files()).toEqual([]);

    const again = await removeBookFiles(t.ctx, ID_A);
    expect(again.actions).toEqual([]);
    expect(again.warnings.map((w) => w.code)).toEqual(["no-files"]);
  });

  it("rejects a malformed book ID before touching the Kobo", async () => {
    await expect(removeBookFiles(t.ctx, "../etc")).rejects.toThrow();
  });

  it("reports a listing failure and does nothing", async () => {
    await t.addBook(makeBook(ID_A), { kepub: "KEPUB-A" });
    const broken: KoboContext = {
      ...t.ctx,
      transport: {
        ...t.ctx.transport,
        list: async () => {
          throw new Error("no route to host");
        },
      },
    };
    const report = await reconcile(broken, [ID_A]);
    expect(report.actions).toEqual([]);
    expect(report.errors.map((e) => e.code)).toEqual(["listing-failed"]);
    expect(report.errors[0]?.message).toContain("nothing was done");
  });

  it("picks the local folder transport from ELIB_KOBO_LOCAL_DIR", () => {
    const viaEnv = createKoboContext(
      { kobo: t.kobo, dataDir: t.env.dataDir, cache: { dir: t.env.cacheDir } },
      { env: t.env.env },
    );
    expect(viaEnv.transport.description).toBe(path.resolve(t.env.koboDir));
  });
});
