import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cachedEpubPath,
  cachedKepubPath,
  isNonEmptyFile,
  uploadDir,
} from "../../../src/node/cache/index.ts";
import { readBook, readBookJsonText, writeBook } from "../../../src/node/repo/index.ts";
import {
  DriveFailedError,
  ServiceError,
  analyzeUpload,
  bulkUpdate,
  createBook,
  deleteBook,
  updateBook,
} from "../../../src/node/services/index.ts";
import type { NewBook } from "../../../src/shared/api.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { makeTempDir } from "../../helpers/tmp.ts";
import {
  OL_COVER_ID,
  OL_ISBN,
  type ServicesTestEnv,
  failingKepubRclone,
  openLibraryFetch,
  setupServices,
  whichBinary,
} from "./setup.ts";

const NEW_BOOK: NewBook = {
  title: "Il giardino delle prove",
  authors: ["Ada Esempio", "Bruno Campione"],
  topic: "narrativa",
  status: "to-read",
  tags: ["prova"],
};

async function expectServiceError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).status).toBe(status);
  expect((error as ServiceError).code).toBe(code);
  return error as ServiceError;
}

async function upload(t: ServicesTestEnv, epub: Uint8Array, fileName = "libro.epub") {
  return analyzeUpload(t.ctx, { fileName, bytes: epub });
}

async function createFrom(
  t: ServicesTestEnv,
  epub: Uint8Array,
  book: Partial<NewBook> = {},
): Promise<Book> {
  const analysis = await upload(t, epub);
  const result = await createBook(t.ctx, {
    uploadId: analysis.uploadId,
    book: { ...NEW_BOOK, ...book },
    cover: "epub",
  });
  expect(result.report.errors).toEqual([]);
  return result.book;
}

describe.skipIf(!hasBinary("rclone") || !hasBinary("kepubify"))("book services", () => {
  let t: ServicesTestEnv;
  let epub: Uint8Array;
  beforeEach(async () => {
    t = await setupServices();
    epub = await buildEpub();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("analyzeUpload: metadata, EPUB cover candidate, staged files; nothing in the repo", async () => {
    const res = await upload(t, epub, "../strano/Il giardino.epub");
    expect(res.fileName).toBe("Il giardino.epub");
    expect(res.metadata).toMatchObject({
      title: "Il giardino delle prove",
      authors: ["Ada Esempio", "Bruno Campione"],
      subjects: ["Narrativa", "Test"],
      isbn: OL_ISBN,
      language: "it",
    });
    expect(res.covers).toEqual([
      expect.objectContaining({
        source: "epub",
        url: `/api/library/uploads/${res.uploadId}/covers/epub`,
        needsConfirmation: false,
      }),
    ]);
    expect(res.duplicates).toEqual([]);
    expect(res.warnings.some((w) => w.startsWith("Open Library"))).toBe(true); // offline fetch
    const dir = uploadDir(t.env.cacheDir, res.uploadId);
    expect((await readdir(dir)).sort()).toEqual([
      "analysis.json",
      "cover-epub.webp",
      "upload.epub",
    ]);
    expect((await sharp(path.join(dir, "cover-epub.webp")).metadata()).format).toBe("webp");
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([]);
  });

  it("analyzeUpload rejects non-EPUBs, KEPUBs and oversized files", async () => {
    await expectServiceError(
      analyzeUpload(t.ctx, { fileName: "x.epub", bytes: new TextEncoder().encode("not a zip") }),
      400,
      "not-an-epub",
    );
    await expectServiceError(
      analyzeUpload(t.ctx, { fileName: "x.kepub.epub", bytes: epub }),
      400,
      "kepub-not-supported",
    );
    const small = t.makeCtx({ limits: { epubMaxBytes: 100 } });
    await expectServiceError(
      analyzeUpload(small, { fileName: "x.epub", bytes: epub }),
      413,
      "payload-too-large",
    );
    // No staging dir left behind by the rejected uploads.
    expect(await readdir(path.join(t.env.cacheDir, "uploads")).catch(() => [])).toEqual([]);
  });

  it("createBook: cache + kepubify → cover.webp → Drive → book.json last; retry returns the same book", async () => {
    const analysis = await upload(t, epub);
    const request = { uploadId: analysis.uploadId, book: NEW_BOOK, cover: "epub" as const };
    const { book, report } = await createBook(t.ctx, request);
    expect(report.errors).toEqual([]);
    expect(report.actions.map((a) => `${a.type}:${a.status}:${a.tree}`).sort()).toEqual([
      "upload:done:archive",
      "upload:done:kobo",
    ]);
    const exp = await t.expected(book);
    expect(exp.epub).toBe(
      `Archivio/Narrativa/Ada Esempio - Il giardino delle prove [${book.id}].epub`,
    );
    expect(await t.remoteFiles()).toEqual([exp.kepub, exp.epub].sort());
    expect(new Uint8Array(await readFile(t.env.remote.localPath(exp.epub)))).toEqual(epub);
    expect(await readBook(t.env.dataDir, book.id)).toEqual(book);
    expect(book).toMatchObject({ ...NEW_BOOK, id: book.id });
    expect(
      (await sharp(path.join(t.env.dataDir, "books", book.id, "cover.webp")).metadata()).format,
    ).toBe("webp");
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    expect(await isNonEmptyFile(cachedKepubPath(t.env.cacheDir, book.id))).toBe(true);
    const staging = uploadDir(t.env.cacheDir, analysis.uploadId);
    expect((await readdir(staging)).sort()).toEqual(["analysis.json", "state.json"]);

    // Retry of the same request (lost response): same book, no second ID, no new Drive file.
    const again = await createBook(t.ctx, request);
    expect(again.book).toEqual(book);
    expect(again.report.actions).toEqual([]);
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([book.id]);
    expect(await t.remoteFiles()).toEqual([exp.kepub, exp.epub].sort());
  });

  it("createBook with the Open Library cover stores openLibraryCoverId and the ISBN", async () => {
    const ol = await openLibraryFetch();
    const ctx = t.makeCtx({ fetch: ol.fetch });
    const analysis = await analyzeUpload(ctx, { fileName: "a.epub", bytes: epub });
    const candidate = analysis.covers.find((c) => c.source === "openlibrary");
    expect(candidate).toMatchObject({
      openLibraryCoverId: OL_COVER_ID,
      matchedBy: "isbn",
      needsConfirmation: false,
    });
    const withoutIsbn = NEW_BOOK; // the form sent no ISBN: the one of the ISBN match is stored
    await expectServiceError(
      createBook(ctx, {
        uploadId: analysis.uploadId,
        book: withoutIsbn,
        cover: "openlibrary",
        openLibraryCoverId: 1,
      }),
      409,
      "cover-changed",
    );
    const { book } = await createBook(ctx, {
      uploadId: analysis.uploadId,
      book: withoutIsbn,
      cover: "openlibrary",
      openLibraryCoverId: OL_COVER_ID,
    });
    expect(book.openLibraryCoverId).toBe(OL_COVER_ID);
    expect(book.isbn).toBe(OL_ISBN);
  });

  it("createBook validates topic and cover before reserving anything", async () => {
    const noCover = await buildEpub({ cover: false, title: "Senza copertina" });
    const analysis = await upload(t, noCover);
    expect(analysis.covers).toEqual([]);
    await expectServiceError(
      createBook(t.ctx, { uploadId: analysis.uploadId, book: NEW_BOOK, cover: "epub" }),
      400,
      "cover-unavailable",
    );
    await expectServiceError(
      createBook(t.ctx, {
        uploadId: analysis.uploadId,
        book: { ...NEW_BOOK, topic: "inesistente" },
        cover: "placeholder",
      }),
      400,
      "unknown-topic",
    );
    await expectServiceError(
      createBook(t.ctx, {
        uploadId: "00000000-0000-4000-8000-000000000000",
        book: NEW_BOOK,
        cover: "placeholder",
      }),
      404,
      "upload-not-found",
    );
    const { book } = await createBook(t.ctx, {
      uploadId: analysis.uploadId,
      book: NEW_BOOK,
      cover: "placeholder",
    });
    expect(await isNonEmptyFile(path.join(t.env.dataDir, "books", book.id, "cover.webp"))).toBe(
      true,
    );
  });

  it("a Drive failure half-way leaves no book in the repo; the retry reuses the ID without duplicates", async () => {
    const tmp = await makeTempDir("elib-fake-rclone-");
    try {
      const failing = t.makeCtx({
        rcloneBinary: await failingKepubRclone(tmp.dir, whichBinary("rclone")),
      });
      const analysis = await analyzeUpload(failing, { fileName: "a.epub", bytes: epub });
      const request = { uploadId: analysis.uploadId, book: NEW_BOOK, cover: "epub" as const };
      const error = await expectServiceError(createBook(failing, request), 502, "drive-failed");
      expect(error).toBeInstanceOf(DriveFailedError);
      const report = (error as DriveFailedError).report;
      expect(report.errors.map((e) => e.code)).toContain("rclone-failed");

      // Nothing half-written in the repo; the EPUB did reach the Archive.
      expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([]);
      const state = JSON.parse(
        await readFile(
          path.join(uploadDir(t.env.cacheDir, analysis.uploadId), "state.json"),
          "utf8",
        ),
      ) as { bookId: string; status: string };
      expect(state.status).toBe("reserved");
      const files = await t.remoteFiles();
      expect(files).toEqual([
        `Archivio/Narrativa/Ada Esempio - Il giardino delle prove [${state.bookId}].epub`,
      ]);

      // Retry with a working rclone: same ID, one EPUB and one KEPUB.
      const { book, report: retryReport } = await createBook(t.ctx, request);
      expect(book.id).toBe(state.bookId);
      expect(retryReport.errors).toEqual([]);
      expect(retryReport.actions.map((a) => `${a.type}:${a.tree}`)).toEqual(["upload:kobo"]);
      const exp = await t.expected(book);
      expect(await t.remoteFiles()).toEqual([exp.kepub, exp.epub].sort());
      expect(await readBookJsonText(t.env.dataDir, book.id)).not.toBeNull();
    } finally {
      await tmp.cleanup();
    }
  });

  it("duplicates: same MD5 on the Archive and same title+author in the repo", async () => {
    const book = await createFrom(t, epub);
    const res = await upload(t, epub);
    expect(res.duplicates).toEqual([
      {
        kind: "md5",
        path: `Archivio/Narrativa/Ada Esempio - Il giardino delle prove [${book.id}].epub`,
        bookId: book.id,
      },
      { kind: "title-author", bookId: book.id, title: book.title, authors: book.authors },
    ]);
    // Same title in another spelling, different file: only the title+author warning.
    const other = await buildEpub({ title: "IL GIARDINO delle prové", creators: ["ada esempio"] });
    const res2 = await upload(t, other);
    expect(res2.duplicates.map((d) => d.kind)).toEqual(["title-author"]);
  });

  it("updateBook: null removes, unknown fields kept, files move with topic/title", async () => {
    const book = await createFrom(t, epub, { rating: 4 });
    await writeBook(t.env.dataDir, { ...book, personal: { note: "a mano" } } as Book);
    const before = await t.expected(book);

    const { book: updated, report } = await updateBook(t.ctx, book.id, {
      topic: "filosofia",
      title: "Un titolo nuovo",
      rating: null,
      status: "reading",
    });
    expect(report.errors).toEqual([]);
    expect(report.actions.filter((a) => a.type === "move").map((a) => a.status)).toEqual([
      "done",
      "done",
    ]);
    expect(updated).toMatchObject({
      topic: "filosofia",
      title: "Un titolo nuovo",
      status: "reading",
    });
    expect(updated.rating).toBeUndefined();
    const onDisk = (await readBook(t.env.dataDir, book.id)) as Book & { personal?: unknown };
    expect(onDisk.personal).toEqual({ note: "a mano" });
    expect(onDisk.rating).toBeUndefined();
    const after = await t.expected(updated);
    expect(after.epub).toBe(`Archivio/Filosofia/Ada Esempio - Un titolo nuovo [${book.id}].epub`);
    const files = await t.remoteFiles();
    expect(files).toEqual([after.kepub, after.epub].sort());
    expect(files).not.toContain(before.epub);
    expect(await t.remoteDirs()).not.toContain("Archivio/Narrativa");

    await expectServiceError(updateBook(t.ctx, book.id, { topic: "nope" }), 400, "unknown-topic");
    await expectServiceError(
      updateBook(t.ctx, "zzzzzzzz", { status: "read" }),
      404,
      "book-not-found",
    );
    await expectServiceError(
      updateBook(t.ctx, book.id, { id: "x" } as never),
      400,
      "invalid-request",
    );
  });

  it("bulkUpdate: topic/status/tags on several books, one reconcile; missing ID writes nothing", async () => {
    const a = await createFrom(t, epub, { tags: ["Storia", "vecchio"] });
    const b = await createFrom(t, await buildEpub({ title: "Secondo libro" }), {
      title: "Secondo libro",
    });
    // Fields this app does not know must survive a bulk edit (PLAN §5).
    await writeBook(t.env.dataDir, { ...a, personal: { note: "a mano" }, extra: 7 } as Book);
    await expectServiceError(
      bulkUpdate(t.ctx, { ids: [a.id, "zzzzzzzz"], patch: { status: "read" } }),
      404,
      "book-not-found",
    );
    expect((await readBook(t.env.dataDir, a.id)).status).toBe("to-read");

    const { books, report } = await bulkUpdate(t.ctx, {
      ids: [a.id, b.id],
      patch: {
        topic: "saggistica",
        status: "read",
        addTags: ["storia", "nuovo"],
        removeTags: ["VECCHIO"],
      },
    });
    expect(report.errors).toEqual([]);
    expect(books.map((x) => [x.topic, x.status, x.tags])).toEqual([
      ["saggistica", "read", ["Storia", "nuovo"]],
      ["saggistica", "read", ["prova", "storia", "nuovo"]],
    ]);
    const files = await t.remoteFiles();
    expect(files.every((f) => f.split("/")[1] === "Saggistica")).toBe(true);
    expect(files).toHaveLength(4);

    const { books: cleared } = await bulkUpdate(t.ctx, {
      ids: [b.id],
      patch: { removeTags: ["prova", "storia", "nuovo"] },
    });
    expect(cleared[0]!.tags).toBeUndefined();

    const kept = (await readBook(t.env.dataDir, a.id)) as Book & Record<string, unknown>;
    expect(kept.personal).toEqual({ note: "a mano" });
    expect(kept.extra).toBe(7);
    expect(kept).toMatchObject({ topic: "saggistica", status: "read" });
  });

  it("deleteBook: Drive files trashed, repo folder removed, cache kept", async () => {
    const book = await createFrom(t, epub);
    const { report } = await deleteBook(t.ctx, book.id);
    expect(report.errors).toEqual([]);
    expect(report.actions.filter((a) => a.type === "trash")).toHaveLength(2);
    expect(await t.remoteFiles()).toEqual([]);
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([]);
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    await expectServiceError(deleteBook(t.ctx, book.id), 404, "book-not-found");
  });

  it("deleteBook keeps the repo folder when Drive fails", async () => {
    const book = await createFrom(t, epub);
    const broken = t.makeCtx({ rcloneBinary: "/nonexistent/rclone" });
    await expectServiceError(deleteBook(broken, book.id), 502, "drive-failed");
    expect(await readBookJsonText(t.env.dataDir, book.id)).not.toBeNull();
  });

  it("serializes concurrent writes", async () => {
    const book = await createFrom(t, epub);
    const results = await Promise.all([
      updateBook(t.ctx, book.id, { tags: ["a"] }),
      updateBook(t.ctx, book.id, { status: "read" }),
      bulkUpdate(t.ctx, { ids: [book.id], patch: { addTags: ["b"] } }),
    ]);
    expect(results.every((r) => r.report.errors.length === 0)).toBe(true);
    const final = await readBook(t.env.dataDir, book.id);
    expect(final.status).toBe("read");
    expect(final.tags).toEqual(["a", "b"]);
  });
});

describe.skipIf(!hasBinary("rclone") || !hasBinary("kepubify"))("upload staging cleanup", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("removes staging dirs older than 24h with the leftovers of a failed attempt", async () => {
    const { cleanupStaleUploads, discardUpload } =
      await import("../../../src/node/services/index.ts");
    const epub = await buildEpub();
    const fresh = await analyzeUpload(t.ctx, { fileName: "a.epub", bytes: epub });
    const stale = await analyzeUpload(t.ctx, { fileName: "b.epub", bytes: epub });
    // Simulate a failed attempt of `stale`: reserved ID, cached EPUB, cover-only repo folder.
    const staleDir = uploadDir(t.env.cacheDir, stale.uploadId);
    const analysis = JSON.parse(await readFile(path.join(staleDir, "analysis.json"), "utf8"));
    analysis.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    await writeFile(path.join(staleDir, "analysis.json"), JSON.stringify(analysis));
    await writeFile(
      path.join(staleDir, "state.json"),
      JSON.stringify({ bookId: "abcd1234", status: "reserved" }),
    );
    await mkdir(path.join(t.env.dataDir, "books", "abcd1234"), { recursive: true });
    await writeFile(path.join(t.env.dataDir, "books", "abcd1234", "cover.webp"), "x");
    await mkdir(path.dirname(cachedEpubPath(t.env.cacheDir, "abcd1234")), { recursive: true });
    await writeFile(cachedEpubPath(t.env.cacheDir, "abcd1234"), "x");
    // A foreign folder is never touched.
    await mkdir(path.join(t.env.cacheDir, "uploads", "not-an-upload"), { recursive: true });

    expect(await cleanupStaleUploads(t.ctx)).toBe(1);
    const left = (await readdir(path.join(t.env.cacheDir, "uploads"))).sort();
    expect(left).toEqual([fresh.uploadId, "not-an-upload"].sort());
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([]);
    await expect(stat(cachedEpubPath(t.env.cacheDir, "abcd1234"))).rejects.toThrow();

    await discardUpload(t.ctx, fresh.uploadId);
    expect(await readdir(path.join(t.env.cacheDir, "uploads"))).toEqual(["not-an-upload"]);
  });
});
