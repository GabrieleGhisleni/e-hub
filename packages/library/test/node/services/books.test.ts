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
import { reconcile } from "../../../src/node/kobo/index.ts";
import {
  KoboFailedError,
  ServiceError,
  analyzeUpload,
  bulkUpdate,
  createBook,
  deleteBook,
  updateBook,
} from "../../../src/node/services/index.ts";
import type { NewBook } from "../../../src/shared/api.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import {
  OL_COVER_ID,
  OL_ISBN,
  type ServicesTestEnv,
  offlineKoboTransport,
  openLibraryFetch,
  setupServices,
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

/** The two names a book has on the Kobo: the KEPUB and its KOReader sidecar folder. */
function koboNamesOf(book: Book): string[] {
  return [koboFileName(book, "kepub"), koboFileName(book, "sidecar")].sort();
}

describe.skipIf(!hasBinary("kepubify"))("book services", () => {
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

  it("createBook: cache + kepubify → cover.webp → book.json → Kobo; retry returns the same book", async () => {
    const analysis = await upload(t, epub);
    const request = { uploadId: analysis.uploadId, book: NEW_BOOK, cover: "epub" as const };
    const { book, report } = await createBook(t.ctx, request);
    expect(report.errors).toEqual([]);
    expect(report.actions.map((a) => `${a.type}:${a.status}`).sort()).toEqual([
      "metadata:done",
      "upload:done",
    ]);
    expect(await t.koboNames()).toEqual(koboNamesOf(book));
    expect(
      new Uint8Array(await readFile(path.join(t.env.koboDir, koboFileName(book, "kepub")))),
    ).toEqual(new Uint8Array(await readFile(cachedKepubPath(t.env.cacheDir, book.id))));
    expect(await t.koboMetadata(book)).toContain('["series"] = "Narrativa"');
    expect(await readBook(t.env.dataDir, book.id)).toEqual(book);
    expect(book).toMatchObject({ ...NEW_BOOK, id: book.id });
    expect(
      (await sharp(path.join(t.env.dataDir, "books", book.id, "cover.webp")).metadata()).format,
    ).toBe("webp");
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    expect(await isNonEmptyFile(cachedKepubPath(t.env.cacheDir, book.id))).toBe(true);
    const staging = uploadDir(t.env.cacheDir, analysis.uploadId);
    expect((await readdir(staging)).sort()).toEqual(["analysis.json", "state.json"]);

    // Retry of the same request (lost response): same book, no second ID, nothing new on the Kobo.
    const again = await createBook(t.ctx, request);
    expect(again.book).toEqual(book);
    expect(again.report.actions).toEqual([]);
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([book.id]);
    expect(await t.koboNames()).toEqual(koboNamesOf(book));
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

  it("a Kobo that is off does not fail the create: the book exists, the retry aligns the Kobo", async () => {
    const offline = t.makeCtx({ transport: offlineKoboTransport(t.env.koboDir) });
    const analysis = await analyzeUpload(offline, { fileName: "a.epub", bytes: epub });
    const request = { uploadId: analysis.uploadId, book: NEW_BOOK, cover: "epub" as const };
    const { book, report } = await createBook(offline, request);
    expect(report.errors.map((e) => e.code)).toEqual(["listing-failed"]);
    expect(await readBook(t.env.dataDir, book.id)).toEqual(book);
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    expect(await isNonEmptyFile(cachedKepubPath(t.env.cacheDir, book.id))).toBe(true);
    expect(await t.koboNames()).toEqual([]);

    // The Kobo comes back: the retry uploads what is missing, with the same ID.
    const again = await createBook(t.ctx, request);
    expect(again.book.id).toBe(book.id);
    expect(again.report.errors).toEqual([]);
    expect(again.report.actions.map((a) => a.type)).toContain("upload");
    expect(await t.koboNames()).toEqual(koboNamesOf(book));
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([book.id]);
  });

  it("duplicates: same MD5 as a cached EPUB and same title+author in the repo", async () => {
    const book = await createFrom(t, epub);
    const res = await upload(t, epub);
    expect(res.duplicates).toEqual([
      {
        kind: "md5",
        path: cachedEpubPath(t.env.cacheDir, book.id),
        bookId: book.id,
      },
      { kind: "title-author", bookId: book.id, title: book.title, authors: book.authors },
    ]);
    // Same title in another spelling, different file: only the title+author warning.
    const other = await buildEpub({ title: "IL GIARDINO delle prové", creators: ["ada esempio"] });
    const res2 = await upload(t, other);
    expect(res2.duplicates.map((d) => d.kind)).toEqual(["title-author"]);
  });

  it("updateBook: null removes, unknown fields kept, files renamed with title, series rewritten with topic", async () => {
    const book = await createFrom(t, epub, { rating: 4 });
    await writeBook(t.env.dataDir, { ...book, personal: { note: "a mano" } } as Book);

    const { book: updated, report } = await updateBook(t.ctx, book.id, {
      topic: "filosofia",
      title: "Un titolo nuovo",
      rating: null,
      status: "reading",
    });
    expect(report.errors).toEqual([]);
    expect(report.actions.filter((a) => a.type === "rename").map((a) => a.status)).toEqual([
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
    expect(await t.koboNames()).toEqual(koboNamesOf(updated));
    expect(koboFileName(updated, "kepub")).toBe(
      `Ada Esempio - Un titolo nuovo [${book.id}].kepub.epub`,
    );
    expect(await t.koboMetadata(updated)).toContain('["series"] = "Filosofia"');

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
    expect(await t.koboNames()).toHaveLength(4);
    expect(await t.koboMetadata(a)).toContain('["series"] = "Saggistica"');
    expect(await t.koboMetadata(b)).toContain('["series"] = "Saggistica"');

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

  it("deleteBook: KEPUB and sidecar removed from the Kobo, repo folder removed, cache kept", async () => {
    const book = await createFrom(t, epub);
    const { report } = await deleteBook(t.ctx, book.id);
    expect(report.errors).toEqual([]);
    expect(report.actions.filter((a) => a.type === "remove")).toHaveLength(2);
    expect(await t.koboNames()).toEqual([]);
    expect(await readdir(path.join(t.env.dataDir, "books"))).toEqual([]);
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(true);
    await expectServiceError(deleteBook(t.ctx, book.id), 404, "book-not-found");
  });

  it("deleteBook keeps the repo folder and the Kobo files when the Kobo is unreachable", async () => {
    const book = await createFrom(t, epub);
    const broken = t.makeCtx({ transport: offlineKoboTransport(t.env.koboDir) });
    const error = await expectServiceError(deleteBook(broken, book.id), 502, "kobo-failed");
    expect(error).toBeInstanceOf(KoboFailedError);
    expect((error as KoboFailedError).report.errors.map((e) => e.code)).toEqual(["listing-failed"]);
    expect(await readBookJsonText(t.env.dataDir, book.id)).not.toBeNull();
    expect(await t.koboNames()).toEqual(koboNamesOf(book));
    // A reconcile of the book reaches the same state as before (nothing was half-done).
    expect((await reconcile(t.ctx.kobo, [book.id])).errors).toEqual([]);
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

describe.skipIf(!hasBinary("kepubify"))("upload staging cleanup", () => {
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
