import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { progressLine } from "../../../src/node/cli/commands/summarize.ts";
import {
  AiFailedError,
  type SummarizeProgress,
  rateLimitWaitSeconds,
  summarizeBook,
} from "../../../src/node/summary/index.ts";
import { cachedEpubPath } from "../../../src/node/cache/index.ts";
import { type TestEnv, buildEpub, createTestEnv } from "../../helpers/index.ts";
import { type Reply, type ScriptedModel, prose, scriptedModel, seedBook } from "./helpers.ts";

const ID = "fx000002";
const ANSWER: Reply = "Una sintesi con parole mie: il racconto di una storia e del tempo che scorre.";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

function deps(model: ScriptedModel["model"], sleep?: Sleep) {
  return {
    dataDir: env.dataDir,
    text: { dataDir: env.dataDir, cacheDir: env.cacheDir },
    model,
    configuredModel: "smart",
    now: () => new Date(1_000_000),
    retryDelayMs: 0,
    ...(sleep ? { sleep } : {}),
  };
}

const progressPath = () => path.join(env.cacheDir, "books", ID, "summary-progress.json");
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** An error shaped like the AI SDK's APICallError: HTTP status and response headers. */
function httpError(statusCode: number, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, responseHeaders: headers });
}

const isChapter = (n: number, title: string) => (call: { user: string }) =>
  call.user.includes(`Capitolo ${n}: "${title}"`);

/** Four long chapters (300 words each), so each one gets a model call. */
const FOUR = ["Uno", "Due", "Tre", "Quattro"];
async function seedFour(texts: Partial<Record<string, string>> = {}): Promise<void> {
  await seedBook(
    env,
    ID,
    FOUR.map((title) => ({ title, words: 300, ...(texts[title] ? { text: texts[title] } : {}) })),
  );
}

describe("rate limits: wait and retry", () => {
  it("waits the retry-after seconds on 503 and then succeeds", async () => {
    await seedFour();
    const sleeps: number[] = [];
    let failed = false;
    const mock = scriptedModel((call) => {
      if (isChapter(1, "Uno")(call) && !failed) {
        failed = true;
        return httpError(503, { "retry-after": "7" });
      }
      return ANSWER;
    });
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(
      deps(mock.model, async (ms) => void sleeps.push(ms)),
      ID,
      { language: "it", concurrency: 1, onProgress: (e) => events.push(e) },
    );
    expect(result.summarizedChapters).toBe(4);
    expect(sleeps).toEqual([7000]);
    expect(events).toContainEqual({ kind: "waiting", seconds: 7, chapter: 'capitolo 1 "Uno"' });
    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(2);
  });

  it("caps the wait at 120 seconds", async () => {
    await seedFour();
    const sleeps: number[] = [];
    let failed = false;
    const mock = scriptedModel((call) => {
      if (isChapter(1, "Uno")(call) && !failed) {
        failed = true;
        return httpError(429, { "retry-after": "500" });
      }
      return ANSWER;
    });
    await summarizeBook(deps(mock.model, async (ms) => void sleeps.push(ms)), ID, {
      language: "it",
      concurrency: 1,
    });
    expect(sleeps).toEqual([120_000]);
  });

  it("waits 30 seconds when the answer has no usable retry-after", async () => {
    await seedFour();
    const sleeps: number[] = [];
    let failed = false;
    const mock = scriptedModel((call) => {
      if (isChapter(1, "Uno")(call) && !failed) {
        failed = true;
        return httpError(429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" });
      }
      return ANSWER;
    });
    await summarizeBook(deps(mock.model, async (ms) => void sleeps.push(ms)), ID, {
      language: "it",
      concurrency: 1,
    });
    expect(sleeps).toEqual([30_000]);
  });

  it("gives up after 4 attempts in total for that call", async () => {
    await seedFour();
    const sleeps: number[] = [];
    const mock = scriptedModel((call) => (isChapter(1, "Uno")(call) ? httpError(503, { "retry-after": "1" }) : ANSWER));
    const error = await summarizeBook(deps(mock.model, async (ms) => void sleeps.push(ms)), ID, {
      language: "it",
      concurrency: 1,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as AiFailedError).message).toContain('capitolo 1 "Uno"');
    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(4);
    expect(sleeps).toEqual([1000, 1000, 1000]);
    expect(await exists(path.join(env.dataDir, "books", ID, "summary.json"))).toBe(false);
  });

  it("keeps the single retry for other errors (no wait with retry-after)", async () => {
    await seedFour();
    const sleeps: number[] = [];
    const mock = scriptedModel((call) => (isChapter(1, "Uno")(call) ? httpError(500, { "retry-after": "9" }) : ANSWER));
    await expect(
      summarizeBook(deps(mock.model, async (ms) => void sleeps.push(ms)), ID, { language: "it", concurrency: 1 }),
    ).rejects.toBeInstanceOf(AiFailedError);
    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(2);
    expect(sleeps).toEqual([0]);
  });

  it("stops a wait as soon as the signal aborts", async () => {
    await seedFour();
    const controller = new AbortController();
    const mock = scriptedModel(() => httpError(503, { "retry-after": "120" }));
    setTimeout(() => controller.abort(), 20);
    const started = Date.now();
    await expect(
      summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reads the retry-after header only for 429 and 503", () => {
    expect(rateLimitWaitSeconds(httpError(503, { "retry-after": "5" }))).toBe(5);
    expect(rateLimitWaitSeconds(httpError(429, { "Retry-After": "2.5" }))).toBe(2.5);
    expect(rateLimitWaitSeconds(httpError(429))).toBe(30);
    expect(rateLimitWaitSeconds(httpError(500, { "retry-after": "5" }))).toBeUndefined();
    expect(rateLimitWaitSeconds(new Error("plain"))).toBeUndefined();
    expect(rateLimitWaitSeconds(undefined)).toBeUndefined();
  });
});

describe("checkpoint and resume", () => {
  /** Run 1: chapters 1 and 2 are summarized, chapter 3 fails for good. */
  async function failingRun(): Promise<unknown> {
    await seedFour();
    const mock = scriptedModel((call) =>
      isChapter(3, "Tre")(call) ? new Error("400 bad request") : ANSWER,
    );
    return summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 }).catch((e: unknown) => e);
  }

  it("saves each chapter summary and says how many were saved when the run fails", async () => {
    const error = await failingRun();
    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as AiFailedError).savedChapters).toBe(2);
    expect((error as AiFailedError).message).toContain('capitolo 3 "Tre"');
    expect((error as AiFailedError).message).toContain("2 capitoli salvati: rilancia per riprendere");
    const saved = JSON.parse(await readFile(progressPath(), "utf8"));
    expect(saved.chapters.map((c: { n: number }) => c.n)).toEqual([1, 2]);
  });

  it("a later run reuses the saved chapters and calls the model only for the missing ones", async () => {
    await failingRun();
    const mock = scriptedModel(() => ANSWER);
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 1,
      onProgress: (e) => events.push(e),
    });

    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(0);
    expect(mock.calls.filter(isChapter(2, "Due"))).toHaveLength(0);
    expect(mock.calls.filter(isChapter(3, "Tre"))).toHaveLength(1);
    expect(mock.calls.filter(isChapter(4, "Quattro"))).toHaveLength(1);
    expect(mock.calls).toHaveLength(3); // two chapters and the book
    // Events come in completion order (chapters run in parallel): compare the multiset of statuses.
    const statuses = events.flatMap((e) => (e.kind === "chapter" ? [e.status] : []));
    expect([...statuses].sort()).toEqual(["reused", "reused", "summarized", "summarized"]);
    expect(result.summary.chapters.every((c) => c.summary !== null)).toBe(true);
    expect(result.summary.chapters[0]!.summary).toBe(ANSWER);
  });

  it("does not reuse a chapter whose text changed", async () => {
    await failingRun();
    await seedFour({ Uno: prose(300, "testo nuovo") });
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(1);
    expect(mock.calls.filter(isChapter(2, "Due"))).toHaveLength(0);
  });

  it("force ignores the saved chapters and summarizes everything again", async () => {
    await failingRun();
    // force also re-extracts the text from the EPUB: the book has one with the same four chapters.
    const epub = cachedEpubPath(env.cacheDir, ID);
    await mkdir(path.dirname(epub), { recursive: true });
    await writeFile(
      epub,
      await buildEpub({ chapters: FOUR.map((title) => ({ title, paragraphs: [prose(300, title)] })) }),
    );
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1, force: true });
    expect(mock.calls).toHaveLength(5); // four chapters and the book
    expect(mock.calls.filter(isChapter(1, "Uno"))).toHaveLength(1);
  });

  it("removes the progress file once summary.json is written", async () => {
    await failingRun();
    expect(await exists(progressPath())).toBe(true);
    await summarizeBook(deps(scriptedModel(() => ANSWER).model), ID, { language: "it", concurrency: 1 });
    expect(await exists(progressPath())).toBe(false);
    expect(await exists(path.join(env.dataDir, "books", ID, "summary.json"))).toBe(true);
  });
});

describe("progress lines", () => {
  const chapter = { n: 3, title: "Tre", file: "03.md", words: 300 };

  it("prints the waiting line", () => {
    expect(progressLine({ kind: "waiting", seconds: 7, chapter: 'capitolo 3 "Tre"' })).toBe(
      "  in attesa del modello (7s)…",
    );
  });

  it("prints riusato for a chapter taken from the progress file", () => {
    expect(progressLine({ kind: "chapter", done: 1, total: 4, chapter, status: "reused" })).toBe(
      '  1/4 Capitolo 3 "Tre"… riusato',
    );
  });
});
