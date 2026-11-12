import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/node/server/app.ts";
import { createServices } from "../../../src/node/services/index.ts";
import { summaryModelFromEnv } from "../../../src/node/summary/llm.ts";
import { SummarizeResponseSchema, apiPaths } from "../../../src/shared/api.ts";
import { type ServicesTestEnv, setupServices } from "../services/setup.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { type Reply, scriptedModel, seedBook } from "./helpers.ts";

const UI = "http://127.0.0.1:5173";
const HEADERS = { host: "127.0.0.1:5173", origin: UI, "sec-fetch-site": "same-origin" };
const ID = "fx000002";
const url = (id: string) => `/api/library/books/${id}/summary`;

describe.skipIf(!hasBinary("rclone"))("POST /api/library/books/:id/summary", () => {
  let t: ServicesTestEnv;
  let app: ReturnType<typeof createApp>;
  let gate: { open(): void; promise: Promise<void> };

  const post = (path: string, body?: unknown) =>
    app.request(`http://127.0.0.1:8787${path}`, {
      method: "POST",
      headers: { ...HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });

  async function configure(reply: Reply = "Sintesi di prova."): Promise<void> {
    const mock = scriptedModel(() => reply, { gate: gate.promise });
    t = await setupServices({ summaryModel: () => ({ model: mock.model, configuredModel: "smart" }) });
    app = createApp(createServices(t.ctx), t.config);
  }

  beforeEach(() => {
    let open!: () => void;
    gate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => open() };
  });
  afterEach(async () => {
    gate.open();
    await t?.cleanup();
  });

  it("answers 200 with the summary, and the file is written", async () => {
    await configure();
    gate.open();
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const res = await post(url(ID), { language: "it" });
    expect(res.status).toBe(200);
    const body = SummarizeResponseSchema.parse(await res.json());
    expect(body.summary.bookId).toBe(ID);
    expect(body.summarizedChapters).toBe(1);
  });

  it("accepts an empty body (defaults: language it)", async () => {
    await configure();
    gate.open();
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const res = await post(url(ID));
    expect(res.status).toBe(200);
    expect(SummarizeResponseSchema.parse(await res.json()).summary.language).toBe("it");
  });

  it("404 book-not-found for an unknown book", async () => {
    await configure();
    gate.open();
    const res = await post(url("zzzzzzzz"), {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("book-not-found");
  });

  it("400 invalid-request for a bad body", async () => {
    await configure();
    gate.open();
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const res = await post(url(ID), { language: "x", force: "yes" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid-request");
  });

  it("503 ai-not-configured without EHUB_AI_* settings", async () => {
    // The real default model builder, fed an empty environment: no .env.local is read here.
    t = await setupServices({ summaryModel: () => summaryModelFromEnv({}) });
    app = createApp(createServices(t.ctx), t.config);
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const res = await post(url(ID), {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ai-not-configured");
    expect(body.error.message).toBe("Chat AI non configurata: copia .env.example in .env.local");
  });

  it("409 busy while the same book is being summarized", async () => {
    await configure();
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const first = post(url(ID), {});
    await new Promise((r) => setTimeout(r, 30));
    const second = await post(url(ID), {});
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("busy");
    gate.open();
    expect((await first).status).toBe(200);
  });

  it("422 text-unavailable when the EPUB is neither cached nor on Drive", async () => {
    await configure();
    gate.open();
    await seedBook(t.env, ID, [{ title: "Uno", words: 200 }]);
    const { rm } = await import("node:fs/promises");
    await rm(`${t.env.cacheDir}/books/${ID}/text`, { recursive: true, force: true });
    const res = await post(url(ID), {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("text-unavailable");
  });

  it("uses the path constant of the contract", () => {
    expect(url(ID)).toBe(apiPaths.bookSummary(ID));
  });
});
