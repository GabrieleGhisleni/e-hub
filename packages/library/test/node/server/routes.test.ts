import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/node/server/app.ts";
import { createServices } from "../../../src/node/services/index.ts";
import {
  BookWriteResponseSchema,
  BulkUpdateResponseSchema,
  CoverCandidatesResponseSchema,
  DeleteBookResponseSchema,
  DeleteTopicResponseSchema,
  TopicWriteResponseSchema,
  TopicsResponseSchema,
  UploadResponseSchema,
  apiPaths,
} from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { buildEpub } from "../../helpers/epub.ts";
import { type ServicesTestEnv, noisyJpeg, setupServices } from "../services/setup.ts";

const UI = "http://127.0.0.1:5173";
const HEADERS = { host: "127.0.0.1:5173", origin: UI, "sec-fetch-site": "same-origin" };

describe.skipIf(!hasBinary("rclone") || !hasBinary("kepubify"))(
  "API routes (real services)",
  () => {
    let t: ServicesTestEnv;
    let app: ReturnType<typeof createApp>;
    beforeEach(async () => {
      t = await setupServices();
      app = createApp(createServices(t.ctx), t.config);
    });
    afterEach(async () => {
      await t.cleanup();
    });

    const call = (method: string, path: string, body?: unknown) =>
      app.request(`http://127.0.0.1:8787${path}`, {
        method,
        headers: {
          ...HEADERS,
          ...(body !== undefined && !(body instanceof FormData)
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });

    const errorCode = async (res: Response) =>
      ((await res.json()) as { error: { code: string } }).error.code;

    async function uploadEpub(bytes: Uint8Array, name = "libro.epub") {
      const form = new FormData();
      form.set(
        "file",
        new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/epub+zip" }),
      );
      return call("POST", apiPaths.uploads, form);
    }

    it("upload → create → patch → covers → bulk → delete", async () => {
      // Upload + candidate image.
      let res = await uploadEpub(await buildEpub());
      expect(res.status).toBe(200);
      const upload = UploadResponseSchema.parse(await res.json());
      expect(upload.metadata.title).toBe("Il giardino delle prove");
      res = await call("GET", upload.covers[0]!.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect((await sharp(new Uint8Array(await res.arrayBuffer())).metadata()).format).toBe("webp");
      res = await call("GET", apiPaths.uploadCover(upload.uploadId, "openlibrary"));
      expect([res.status, await errorCode(res)]).toEqual([404, "not-found"]);

      // Create.
      res = await call("POST", apiPaths.books, {
        uploadId: upload.uploadId,
        book: {
          title: "Il giardino delle prove",
          authors: ["Ada Esempio"],
          topic: "narrativa",
          status: "to-read",
        },
        cover: "epub",
      });
      expect(res.status).toBe(201);
      const created = BookWriteResponseSchema.parse(await res.json());
      const id = created.book.id;
      expect(created.report.errors).toEqual([]);
      expect(await t.remoteFiles()).toHaveLength(2);

      // Patch: validation error, then a move.
      res = await call("PATCH", apiPaths.book(id), { colour: "red" });
      expect([res.status, await errorCode(res)]).toEqual([400, "invalid-request"]);
      res = await call("PATCH", apiPaths.book(id), { topic: "nope" });
      expect([res.status, await errorCode(res)]).toEqual([400, "unknown-topic"]);
      res = await call("PATCH", apiPaths.book("zzzzzzzz"), { status: "read" });
      expect([res.status, await errorCode(res)]).toEqual([404, "book-not-found"]);
      res = await call("PATCH", apiPaths.book(id), { topic: "saggistica", rating: 5 });
      expect(res.status).toBe(200);
      const patched = BookWriteResponseSchema.parse(await res.json());
      expect(patched.book).toMatchObject({ topic: "saggistica", rating: 5 });
      expect(patched.report.actions.filter((a) => a.type === "move")).toHaveLength(2);

      // Cover candidates + set cover (JSON and multipart).
      res = await call("GET", apiPaths.bookCoverCandidates(id));
      const candidates = CoverCandidatesResponseSchema.parse(await res.json());
      expect(candidates.candidates.map((c) => c.source)).toEqual(["epub"]);
      res = await call("GET", apiPaths.bookCoverCandidate(id, "epub"));
      expect(res.headers.get("content-type")).toBe("image/webp");
      res = await call("PUT", apiPaths.bookCover(id), { source: "placeholder" });
      expect(res.status).toBe(200);
      BookWriteResponseSchema.parse(await res.json());
      const form = new FormData();
      form.set(
        "image",
        new File([(await noisyJpeg()) as Uint8Array<ArrayBuffer>], "c.jpg", { type: "image/jpeg" }),
      );
      res = await call("PUT", apiPaths.bookCover(id), form);
      expect(res.status).toBe(200);
      const bad = new FormData();
      bad.set("image", new File(["nope"], "c.jpg"));
      res = await call("PUT", apiPaths.bookCover(id), bad);
      expect([res.status, await errorCode(res)]).toEqual([400, "invalid-image"]);
      res = await call("PUT", apiPaths.bookCover(id), { source: "nothing" });
      expect([res.status, await errorCode(res)]).toEqual([400, "invalid-request"]);

      // Bulk.
      res = await call("POST", apiPaths.bulk, {
        ids: [id],
        patch: { status: "read", addTags: ["x"] },
      });
      expect(res.status).toBe(200);
      const bulk = BulkUpdateResponseSchema.parse(await res.json());
      expect(bulk.books[0]).toMatchObject({ status: "read", tags: ["x"] });
      res = await call("POST", apiPaths.bulk, { ids: ["not-an-id"], patch: { status: "read" } });
      expect([res.status, await errorCode(res)]).toEqual([400, "invalid-request"]);

      // Delete.
      res = await call("DELETE", apiPaths.book(id));
      expect(res.status).toBe(200);
      expect(DeleteBookResponseSchema.parse(await res.json()).id).toBe(id);
      expect(await t.remoteFiles()).toEqual([]);
      res = await call("DELETE", apiPaths.book(id));
      expect([res.status, await errorCode(res)]).toEqual([404, "book-not-found"]);
    });

    it("upload errors and cancelling an upload", async () => {
      let res = await uploadEpub(new TextEncoder().encode("plain text"), "x.epub");
      expect([res.status, await errorCode(res)]).toEqual([400, "not-an-epub"]);
      res = await uploadEpub(await buildEpub(), "x.kepub.epub");
      expect([res.status, await errorCode(res)]).toEqual([400, "kepub-not-supported"]);

      res = await uploadEpub(await buildEpub());
      const { uploadId } = UploadResponseSchema.parse(await res.json());
      res = await call("DELETE", apiPaths.upload(uploadId));
      expect(res.status).toBe(204);
      res = await call("GET", apiPaths.uploadCover(uploadId, "epub"));
      expect([res.status, await errorCode(res)]).toEqual([404, "upload-not-found"]);
      res = await call("POST", apiPaths.books, {
        uploadId,
        book: { title: "T", authors: ["A"], topic: "narrativa", status: "to-read" },
        cover: "placeholder",
      });
      expect([res.status, await errorCode(res)]).toEqual([404, "upload-not-found"]);
    });

    it("topics CRUD with usage", async () => {
      let res = await call("GET", apiPaths.topics);
      const list = TopicsResponseSchema.parse(await res.json());
      expect(list.topics.map((x) => x.id)).toContain("unsorted");

      res = await call("POST", apiPaths.topics, { label: "Storia" });
      expect(res.status).toBe(201);
      expect(TopicWriteResponseSchema.parse(await res.json()).topic).toEqual({
        id: "storia",
        label: "Storia",
      });
      res = await call("POST", apiPaths.topics, { label: "storia" });
      expect([res.status, await errorCode(res)]).toEqual([409, "topic-conflict"]);
      res = await call("POST", apiPaths.topics, {});
      expect([res.status, await errorCode(res)]).toEqual([400, "invalid-request"]);

      res = await call("PATCH", apiPaths.topic("storia"), { label: "Storia antica" });
      expect(res.status).toBe(200);
      expect(TopicWriteResponseSchema.parse(await res.json()).topic.label).toBe("Storia antica");
      res = await call("PATCH", apiPaths.topic("nope"), { label: "X" });
      expect([res.status, await errorCode(res)]).toEqual([404, "topic-not-found"]);

      res = await call("DELETE", apiPaths.topic("storia"));
      expect(res.status).toBe(200);
      expect(DeleteTopicResponseSchema.parse(await res.json())).toMatchObject({
        id: "storia",
        reassigned: 0,
      });
      res = await call("DELETE", apiPaths.topic("unsorted"));
      expect([res.status, await errorCode(res)]).toEqual([400, "topic-protected"]);
    });

    it("health", async () => {
      const res = await call("GET", apiPaths.health);
      expect(await res.json()).toEqual({ ok: true });
    });
  },
);
