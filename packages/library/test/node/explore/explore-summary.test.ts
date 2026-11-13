import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exploreSummaryPath,
  exploreSummaryStatus,
  importExploreEpub,
  readExploreBookSummary,
  summarizeExploreBook,
} from "../../../src/node/explore/index.ts";
import { BookSummarySchema } from "../../../src/shared/schema.ts";
import { type TestEnv, buildEpub, createTestEnv } from "../../helpers/index.ts";
import { prose, scriptedModel } from "../summary/helpers.ts";

const ID = "fx000002";
/** Italian, so it passes the language check for `it`. */
const ANSWER = "Una sintesi con parole mie: il racconto di una storia e del tempo che scorre.";

describe("explore book summaries", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    const bytes = await buildEpub({
      chapters: [
        { title: "Capitolo primo", paragraphs: [prose(200, "primo")] },
        { title: "Capitolo secondo", paragraphs: [prose(200, "secondo")] },
      ],
    });
    await importExploreEpub({ id: ID, bytes, fileName: "saggio.epub" }, { cacheDir: env.cacheDir });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("summarizes the chapters and the book into summary.json, readable back", async () => {
    const mock = scriptedModel(() => ANSWER);
    const result = await summarizeExploreBook(ID, {
      cacheDir: env.cacheDir,
      model: { model: mock.model, configuredModel: "smart" },
    });

    // Two chapter calls and one book call.
    expect(mock.calls).toHaveLength(3);
    expect(result.bookId).toBe(ID);
    expect(result.language).toBe("it");
    expect(result.model).toBe("smart");
    expect(result.chapters.map((c) => c.title)).toEqual(["Capitolo primo", "Capitolo secondo"]);
    expect(result.chapters.every((c) => c.summary === ANSWER)).toBe(true);

    const stored = await readExploreBookSummary(ID, { cacheDir: env.cacheDir });
    expect(stored).toEqual(result);
    expect(BookSummarySchema.safeParse(stored).success).toBe(true);
    expect(exploreSummaryPath(ID, { cacheDir: env.cacheDir })).toMatch(/explore[\\/]books[\\/]fx000002[\\/]summary\.json$/);
    expect(await exploreSummaryStatus(ID, { cacheDir: env.cacheDir })).toEqual({ state: "done" });
  });

  it("returns null for an unknown ID and for an invalid one", async () => {
    expect(await readExploreBookSummary("bbbbbbbb", { cacheDir: env.cacheDir })).toBeNull();
    expect(await readExploreBookSummary("../evil", { cacheDir: env.cacheDir })).toBeNull();
    expect(await exploreSummaryStatus("bbbbbbbb", { cacheDir: env.cacheDir })).toEqual({ state: "none" });
  });

  it("refuses a second run for the same book while one is in progress", async () => {
    const mock = scriptedModel(() => ANSWER);
    const options = { cacheDir: env.cacheDir, model: { model: mock.model, configuredModel: "smart" } };
    const first = summarizeExploreBook(ID, options);
    await expect(summarizeExploreBook(ID, options)).rejects.toThrow(/già in corso/);
    await first;
  });

  it("reports running with progress while a model call is pending, then done", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = scriptedModel(() => ANSWER, { gate });
    const run = summarizeExploreBook(ID, {
      cacheDir: env.cacheDir,
      model: { model: mock.model, configuredModel: "smart" },
    });

    await vi.waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    const pending = await exploreSummaryStatus(ID, { cacheDir: env.cacheDir });
    expect(pending.state).toBe("running");
    expect(pending.total).toBe(2);
    expect(pending.done).toBeLessThan(pending.total!);

    release();
    await run;
    expect(await exploreSummaryStatus(ID, { cacheDir: env.cacheDir })).toEqual({ state: "done" });
  });
});
