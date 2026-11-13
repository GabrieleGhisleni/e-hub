import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedSummaryProgressPath } from "../../../src/node/cache/index.ts";
import {
  AiFailedError,
  LONG_CHAPTER_WORDS,
  type SummarizeProgress,
  summarizeBook,
} from "../../../src/node/summary/index.ts";
import { type TestEnv, createTestEnv } from "../../helpers/index.ts";
import { type ModelCall, scriptedModel, seedBook } from "./helpers.ts";

const ID = "fx000003";
/** Italian, so it passes the language check for `it`. */
const ANSWER = "Una sintesi con parole mie: il racconto di una storia e del tempo che scorre.";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

function deps(model: Parameters<typeof summarizeBook>[0]["model"]) {
  return {
    dataDir: env.dataDir,
    text: { dataDir: env.dataDir, cacheDir: env.cacheDir },
    model,
    configuredModel: "smart",
    now: (() => {
      let t = 1_000_000;
      return () => new Date((t += 1500));
    })(),
    sleep: async () => {},
    retryDelayMs: 0,
  };
}

/** Six chapters of 200 words: none is short (150 words is the cut-off), so each one costs a model call. */
const SIX = ["Uno", "Due", "Tre", "Quattro", "Cinque", "Sei"].map((title) => ({ title, words: 200 }));

/** The chapter prompt quotes the title (`Capitolo 2: "Due"`); the book prompt lists titles without quotes. */
const isChapterCall = (call: ModelCall, title: string) => call.user.includes(`"${title}"`);

describe("summary concurrency", () => {
  it("keeps exactly `concurrency` model calls in flight (3 of 6 chapters) and still runs them in parallel", async () => {
    await seedBook(env, ID, SIX);
    const mock = scriptedModel(() => ANSWER, { delayMs: 15 });
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 3,
      onProgress: (e) => events.push(e),
    });

    expect(mock.maxInFlight()).toBe(3);
    expect(mock.maxInFlight()).toBeGreaterThan(1);
    expect(mock.calls).toHaveLength(7); // six chapters + the book
    // Progress: one event per chapter, `done` counts up, and the chapters stay in order.
    const done = events.flatMap((e) => (e.kind === "chapter" ? [e.done] : []));
    expect(done).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.summary.chapters.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("runs the parts of a long chapter in parallel and lists them in order in the merge prompt", async () => {
    const words = LONG_CHAPTER_WORDS + 1000;
    await seedBook(env, ID, [{ title: "Lungo", words }]);
    const mock = scriptedModel(
      (call) => {
        const part = /[Qq]uesta è la parte (\d+) di/.exec(call.user);
        if (part) return `Idea numero ${part[1]}: il tempo e la storia del libro di prova.`;
        return ANSWER;
      },
      { delayMs: 15 },
    );
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 4 });

    expect(mock.maxInFlight()).toBeGreaterThan(1);
    const merge = mock.calls.find((c) => c.user.includes("sintesi delle"));
    expect(merge).toBeDefined();
    const at = (n: number) => merge!.user.indexOf(`Parte ${n}: Idea numero ${n}:`);
    expect(at(1)).toBeGreaterThan(-1);
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
  });

  it("a failing chapter rejects summarizeBook and no further call starts after it", async () => {
    await seedBook(env, ID, SIX);
    // "Due" fails on every attempt. The queue order of the chapters is not fixed, so the test records how many calls
    // had been sent when the chapter gave up: no call may be sent after that.
    let dueCalls = 0;
    let callsWhenGivingUp = -1;
    const mock = scriptedModel((call, index) => {
      if (!isChapterCall(call, "Due")) return ANSWER;
      dueCalls += 1;
      if (dueCalls === 2) callsWhenGivingUp = index + 1; // two attempts, then the chapter fails
      return new Error("boom");
    });
    const error = await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as AiFailedError).step).toContain('capitolo 2 "Due"');
    expect(callsWhenGivingUp).toBeGreaterThan(0);
    expect(mock.calls).toHaveLength(callsWhenGivingUp);
    expect(mock.calls.some((c) => c.user.includes("sintesi delle") || c.system.includes("scrive la sintesi di un libro"))).toBe(
      false,
    );
  });

  it("writes the progress file as valid JSON after a run interrupted by a failure", async () => {
    await seedBook(env, ID, SIX);
    // Two calls succeed, then every call fails: the run stops with two chapters saved.
    let answered = 0;
    const mock = scriptedModel(() => {
      if (answered >= 2) return new Error("boom");
      answered += 1;
      return ANSWER;
    });
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 }).catch(() => undefined);

    const saved = JSON.parse(await readFile(cachedSummaryProgressPath(env.cacheDir, ID), "utf8")) as {
      chapters: Array<{ n: number; hash: string; summary: string }>;
    };
    expect(saved.chapters).toHaveLength(2);
    expect(new Set(saved.chapters.map((c) => c.n)).size).toBe(2);
    expect(saved.chapters.every((c) => c.summary === ANSWER)).toBe(true);
  });

  it("keeps the progress file valid JSON when chapters finish in parallel and one fails", async () => {
    await seedBook(env, ID, SIX);
    // Four chapters in flight, two answers saved, then every call fails.
    let answered = 0;
    const mock = scriptedModel(
      () => {
        if (answered >= 2) return new Error("boom");
        answered += 1;
        return ANSWER;
      },
      { delayMs: 5 },
    );
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 4 }).catch(() => undefined);

    const saved = JSON.parse(await readFile(cachedSummaryProgressPath(env.cacheDir, ID), "utf8")) as {
      version: number;
      chapters: Array<{ n: number }>;
    };
    expect(saved.version).toBe(1);
    expect(saved.chapters).toHaveLength(2);
    expect(new Set(saved.chapters.map((c) => c.n)).size).toBe(2);
  });
});
