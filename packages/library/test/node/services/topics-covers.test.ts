import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheBookDir, cachedEpubPath, isNonEmptyFile } from "../../../src/node/cache/index.ts";
import { readBook, readTopics } from "../../../src/node/repo/index.ts";
import {
  ServiceError,
  addTopic,
  analyzeUpload,
  coverCandidates,
  createBook,
  deleteTopic,
  listTopics,
  readBookCoverCandidate,
  renameTopic,
  setBookCover,
} from "../../../src/node/services/index.ts";
import type { NewBook } from "../../../src/shared/api.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
import {
  OL_COVER_ID,
  type ServicesTestEnv,
  noisyJpeg,
  openLibraryFetch,
  setupServices,
} from "./setup.ts";

async function expectServiceError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect({ status: (error as ServiceError).status, code: (error as ServiceError).code }).toEqual({
    status,
    code,
  });
}

async function create(t: ServicesTestEnv, book: Partial<NewBook> = {}): Promise<Book> {
  const title = book.title ?? "Il giardino delle prove";
  const analysis = await analyzeUpload(t.ctx, {
    fileName: "x.epub",
    bytes: await buildEpub({ title }),
  });
  const res = await createBook(t.ctx, {
    uploadId: analysis.uploadId,
    book: { title, authors: ["Ada Esempio"], topic: "narrativa", status: "to-read", ...book },
    cover: "epub",
  });
  expect(res.report.errors).toEqual([]);
  return res.book;
}

const coverHash = async (t: ServicesTestEnv, id: string) =>
  (await readFile(path.join(t.env.dataDir, "books", id, "cover.webp"))).toString("base64");

describe.skipIf(!hasBinary("kepubify"))("topic services", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("addTopic derives a stable ID; labels that look the same are rejected", async () => {
    const { topic, topics, report } = await addTopic(t.ctx, "  Storia   antica ");
    expect(topic).toEqual({ id: "storia-antica", label: "Storia antica" });
    expect(topics.at(-1)).toEqual(topic);
    expect(report.actions).toEqual([]);
    expect((await readTopics(t.env.dataDir)).at(-1)).toEqual(topic);
    await expectServiceError(addTopic(t.ctx, "STORIA ANTICA"), 409, "topic-conflict");
    await expectServiceError(addTopic(t.ctx, "   "), 400, "invalid-request");
  });

  it("renameTopic rewrites the series of its books on the Kobo; no file is renamed", async () => {
    const book = await create(t);
    const before = await readFile(path.join(t.env.dataDir, "books", book.id, "book.json"), "utf8");
    const names = await t.koboNames();
    const { topic, report } = await renameTopic(t.ctx, "narrativa", "Romanzi");
    expect(topic).toEqual({ id: "narrativa", label: "Romanzi" });
    expect(report.errors).toEqual([]);
    expect(report.actions.map((a) => a.type)).toEqual(["metadata"]);
    expect(await t.koboNames()).toEqual(names);
    expect(names).toEqual([koboFileName(book, "kepub"), koboFileName(book, "sidecar")].sort());
    expect(await t.koboMetadata(book)).toContain('["series"] = "Romanzi"');
    expect(await readFile(path.join(t.env.dataDir, "books", book.id, "book.json"), "utf8")).toBe(
      before,
    );

    await expectServiceError(renameTopic(t.ctx, "nope", "X"), 404, "topic-not-found");
    await expectServiceError(renameTopic(t.ctx, "filosofia", "romanzi"), 409, "topic-conflict");
    expect((await renameTopic(t.ctx, "filosofia", "Filosofia")).report.actions).toEqual([]);
  });

  it("deleteTopic reassigns its books to unsorted and rewrites their series; unsorted is protected", async () => {
    const a = await create(t, { topic: "filosofia", title: "Primo" });
    const b = await create(t, { topic: "filosofia", title: "Secondo" });
    const c = await create(t, { topic: "narrativa", title: "Terzo" });
    const usage = await listTopics(t.ctx);
    expect(usage.topics.map((x) => [x.id, x.bookCount])).toEqual([
      ["unsorted", 0],
      ["narrativa", 1],
      ["saggistica", 0],
      ["filosofia", 2],
      ["scienze-sociali", 0],
    ]);

    const res = await deleteTopic(t.ctx, "filosofia");
    expect(res.reassigned).toBe(2);
    expect(res.report.errors).toEqual([]);
    expect(res.topics.map((x) => x.id)).not.toContain("filosofia");
    for (const id of [a.id, b.id])
      expect((await readBook(t.env.dataDir, id)).topic).toBe("unsorted");
    expect(await t.koboNames()).toHaveLength(6);
    expect(await t.koboMetadata(a)).toContain('["series"] = "Da smistare"');
    expect(await t.koboMetadata(b)).toContain('["series"] = "Da smistare"');
    expect(await t.koboMetadata(c)).toContain('["series"] = "Narrativa"');

    await expectServiceError(deleteTopic(t.ctx, "unsorted"), 400, "topic-protected");
    await expectServiceError(deleteTopic(t.ctx, "filosofia"), 404, "topic-not-found");
    expect((await deleteTopic(t.ctx, "saggistica")).reassigned).toBe(0);
  });
});

describe.skipIf(!hasBinary("kepubify"))("cover services", () => {
  let t: ServicesTestEnv;
  beforeEach(async () => {
    t = await setupServices();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("candidates: EPUB cover and Open Library by ISBN; the cover can be switched back", async () => {
    const book = await create(t, { isbn: "9788800000000" });
    const ol = await openLibraryFetch();
    const ctx = t.makeCtx({ fetch: ol.fetch });

    const res = await coverCandidates(ctx, book.id);
    expect(res.candidates.map((c) => [c.source, c.url, c.matchedBy, c.openLibraryCoverId])).toEqual(
      [
        ["epub", `/api/library/books/${book.id}/cover-candidates/epub`, undefined, undefined],
        [
          "openlibrary",
          `/api/library/books/${book.id}/cover-candidates/openlibrary`,
          "isbn",
          OL_COVER_ID,
        ],
      ],
    );
    const image = await readBookCoverCandidate(ctx, book.id, "openlibrary");
    expect((await sharp(image).metadata()).format).toBe("webp");
    await expectServiceError(readBookCoverCandidate(ctx, book.id, "other"), 404, "not-found");

    const before = await coverHash(t, book.id);
    const set = await setBookCover(ctx, book.id, {
      source: "openlibrary",
      openLibraryCoverId: OL_COVER_ID,
    });
    expect(set.book.openLibraryCoverId).toBe(OL_COVER_ID);
    expect(set.report.actions).toEqual([]);
    expect((await readBook(t.env.dataDir, book.id)).openLibraryCoverId).toBe(OL_COVER_ID);
    expect(await coverHash(t, book.id)).not.toBe(before);

    await setBookCover(ctx, book.id, { source: "epub" });
    expect(await coverHash(t, book.id)).toBe(before);
    expect((await readBook(t.env.dataDir, book.id)).openLibraryCoverId).toBe(OL_COVER_ID);
  });

  it("without the EPUB in the cache there is no EPUB cover: a warning, nothing downloaded", async () => {
    const book = await create(t);
    await rm(cacheBookDir(t.env.cacheDir, book.id), { recursive: true, force: true });
    const res = await coverCandidates(t.ctx, book.id);
    expect(res.candidates.map((c) => c.source)).toEqual([]);
    expect(res.warnings).toContain(
      "L'EPUB non è nella cache locale: copertina dell'EPUB non disponibile.",
    );
    expect(await isNonEmptyFile(cachedEpubPath(t.env.cacheDir, book.id))).toBe(false);
    await expectServiceError(
      setBookCover(t.ctx, book.id, { source: "epub" }),
      400,
      "cover-unavailable",
    );
  });

  it("placeholder and uploaded image; invalid image rejected; offline Open Library explained", async () => {
    const book = await create(t);
    const res = await coverCandidates(t.ctx, book.id);
    expect(res.candidates.map((c) => c.source)).toEqual(["epub"]);
    expect(res.warnings.some((w) => w.startsWith("Open Library"))).toBe(true);
    await expectServiceError(
      setBookCover(t.ctx, book.id, { source: "openlibrary" }),
      400,
      "cover-unavailable",
    );

    await setBookCover(t.ctx, book.id, { source: "placeholder" });
    const placeholder = await readFile(path.join(t.env.dataDir, "books", book.id, "cover.webp"));
    expect((await sharp(placeholder).metadata()).height).toBe(900);

    await setBookCover(t.ctx, book.id, { image: await noisyJpeg(1200, 1800) });
    const uploaded = await sharp(
      path.join(t.env.dataDir, "books", book.id, "cover.webp"),
    ).metadata();
    expect([uploaded.format, uploaded.width]).toEqual(["webp", 600]);

    await expectServiceError(
      setBookCover(t.ctx, book.id, { image: new TextEncoder().encode("nope") }),
      400,
      "invalid-image",
    );
    await expectServiceError(
      setBookCover(t.makeCtx({ limits: { imageMaxBytes: 10 } }), book.id, {
        image: await noisyJpeg(),
      }),
      413,
      "payload-too-large",
    );
    await expectServiceError(
      setBookCover(t.ctx, "zzzzzzzz", { source: "placeholder" }),
      404,
      "book-not-found",
    );
  });
});
