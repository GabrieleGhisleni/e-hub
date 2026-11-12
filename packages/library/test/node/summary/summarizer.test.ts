import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/node/config/index.ts";
import { createDriveContext } from "../../../src/node/drive/index.ts";
import { readBookSummary } from "../../../src/node/repo/index.ts";
import {
  AiFailedError,
  LONG_CHAPTER_WORDS,
  isFrontOrBackMatter,
  languageInstruction,
  looksLikeLanguage,
  type SummarizeProgress,
  TextUnavailableError,
  splitIntoParts,
  summarizeBook,
} from "../../../src/node/summary/index.ts";
import { BookSummarySchema } from "../../../src/shared/schema.ts";
import { type TestEnv, createTestEnv, hasBinary } from "../../helpers/index.ts";
import { type Reply, type ScriptedModel, prose, scriptedModel, seedBook } from "./helpers.ts";

const ID = "fx000001";
const LONG = "Capitolo lungo";
const SHORT_TITLE = "Copertina";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

function deps(model: ScriptedModel["model"], extra: { retryDelayMs?: number } = {}) {
  const config = loadConfig({ env: env.env });
  return {
    dataDir: env.dataDir,
    drive: createDriveContext(config, { env: env.env }),
    model,
    configuredModel: "smart",
    now: (() => {
      let t = 1_000_000;
      return () => new Date((t += 1500));
    })(),
    sleep: async () => {},
    retryDelayMs: extra.retryDelayMs ?? 0,
  };
}

/** Two long chapters and one short one: the cover. */
async function seedThreeChapters(): Promise<void> {
  await seedBook(env, ID, [
    { title: SHORT_TITLE, words: 12 },
    { title: "Le ore che scivolano", words: 400 },
    { title: "Abitudini", words: 300 },
  ]);
}

/** Italian, so it passes the language check for `it`. */
const ANSWER: Reply = "Una sintesi con parole mie: il racconto di una storia e del tempo che scorre.";
/** English, so it fails the language check for `it`. */
const ENGLISH: Reply = "The chapter is about time and the way that readers are changed by the story of it.";

describe("summarizeBook", () => {
  it("skips short chapters, summarizes the others and writes a valid summary.json", async () => {
    await seedThreeChapters();
    const mock = scriptedModel((call) =>
      call.user.includes("Libro del capitolo") ? ANSWER : `Sintesi di prova (${call.user.length}): il tempo e una storia.`,
    );
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 1,
      onProgress: (e) => events.push(e),
    });

    // Two chapter calls and one book call; the short chapter costs nothing.
    expect(mock.calls).toHaveLength(3);
    expect(result.summarizedChapters).toBe(2);
    expect(result.summary.chapters.map((c) => c.summary === null)).toEqual([true, false, false]);
    expect(result.summary.book.length).toBeGreaterThan(0);
    expect(result.summary.model).toBe("smart");
    expect(result.summary.language).toBe("it");
    expect(result.durationMs).toBeGreaterThan(0);

    const chapterEvents = events.filter((e) => e.kind === "chapter");
    expect(chapterEvents.map((e) => (e.kind === "chapter" ? e.status : ""))).toEqual([
      "skipped",
      "summarized",
      "summarized",
    ]);
    expect(events.at(-1)).toEqual({ kind: "book" });

    const onDisk = JSON.parse(await readFile(path.join(env.dataDir, "books", ID, "summary.json"), "utf8"));
    expect(BookSummarySchema.parse(onDisk).bookId).toBe(ID);
    expect(await readBookSummary(env.dataDir, ID)).toEqual(result.summary);
  });

  it("asks for the requested output language and never copies the book's language", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "en", concurrency: 1 });
    for (const call of mock.calls) {
      expect(call.system).toContain("inglese");
      expect(call.system).toContain("codice en");
    }
    const bookCall = mock.calls.at(-1)!;
    expect(bookCall.user).toContain("Ada Esempio, Luca Prova");
    expect(bookCall.user).toContain("Abitudini");
  });

  it("sends the reasoning effort as providerOptions.ehub on every call when it is set", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook({ ...deps(mock.model), reasoningEffort: "none" }, ID, { language: "it", concurrency: 1 });
    expect(mock.calls).toHaveLength(3);
    for (const call of mock.calls) {
      expect(call.providerOptions).toEqual({ ehub: { reasoningEffort: "none" } });
    }
  });

  it("sends no providerOptions when the reasoning effort is undefined", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    expect(mock.calls.length).toBeGreaterThan(0);
    for (const call of mock.calls) expect(call.providerOptions).toBeUndefined();
  });

  it("writes the router's x-router-model of the last successful call as the model", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ({ text: ANSWER, routerModel: "gemini-3.6-flash" }));
    const result = await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    expect(result.summary.model).toBe("gemini-3.6-flash");
  });

  it("retries a failed call once and then succeeds", async () => {
    await seedThreeChapters();
    const sleeps: number[] = [];
    let failedOnce = false;
    const mock = scriptedModel((call) => {
      if (call.user.includes("Le ore che scivolano") && !failedOnce) {
        failedOnce = true;
        return new Error("503 overloaded");
      }
      return ANSWER;
    });
    const config = deps(mock.model, { retryDelayMs: 2000 });
    const result = await summarizeBook(
      { ...config, sleep: async (ms: number) => void sleeps.push(ms) },
      ID,
      { language: "it", concurrency: 1 },
    );
    expect(result.summarizedChapters).toBe(2);
    expect(sleeps).toEqual([2000]);
    // Two calls for chapter 2 (the book call also names it, so match the chapter prompt's own line).
    expect(mock.calls.filter((c) => c.user.includes('Capitolo 2: "Le ore che scivolano"'))).toHaveLength(2);
  });

  it("fails with AiFailedError naming the chapter after the second failure, and writes nothing", async () => {
    await seedThreeChapters();
    const mock = scriptedModel((call) =>
      call.user.includes("Abitudini") ? new Error("rate limited") : ANSWER,
    );
    const error = await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as AiFailedError).message).toContain('capitolo 3 "Abitudini"');
    expect((error as AiFailedError).message).toContain("rate limited");
    expect(mock.calls.filter((c) => c.user.includes("Abitudini"))).toHaveLength(2);
    expect(await readBookSummary(env.dataDir, ID)).toBeNull();
  });

  it("keeps at most `concurrency` calls in flight", async () => {
    await seedBook(env, ID, [
      { title: "Uno", words: 200 },
      { title: "Due", words: 200 },
      { title: "Tre", words: 200 },
      { title: "Quattro", words: 200 },
    ]);
    const mock = scriptedModel(() => ANSWER, { delayMs: 15 });
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 2 });
    expect(mock.maxInFlight()).toBe(2);
    expect(mock.calls).toHaveLength(5);
  });

  it("splits a very long chapter into parts, summarizes them and merges them", async () => {
    const words = LONG_CHAPTER_WORDS + 1000;
    await seedBook(env, ID, [{ title: LONG, words, text: prose(words, "lungo") }]);
    const mock = scriptedModel(() => ANSWER);
    const result = await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });

    const parts = splitIntoParts(prose(words, "lungo"), 12_000).length;
    expect(parts).toBeGreaterThan(1);
    // parts + merge + book
    expect(mock.calls).toHaveLength(parts + 2);
    expect(mock.calls[0]!.user).toContain(`parte 1 di ${parts}`);
    expect(mock.calls[parts]!.user).toContain("sintesi delle");
    expect(result.summary.chapters[0]!.summary).toBe(ANSWER);
  });

  it.skipIf(!hasBinary("rclone"))("refuses to run without text: TextUnavailableError when the EPUB is neither cached nor on Drive", async () => {
    await seedBook(env, ID, [{ title: "Uno", words: 200 }]);
    await rm(path.join(env.cacheDir, "books", ID, "text"), { recursive: true, force: true });
    const mock = scriptedModel(() => ANSWER);
    await expect(summarizeBook(deps(mock.model), ID, { language: "it" })).rejects.toBeInstanceOf(
      TextUnavailableError,
    );
    expect(mock.calls).toHaveLength(0);
  });

  it("the prompts carry the chapter text", async () => {
    const text = `Frase unica di prova sul tema. ${prose(200, "x")}`;
    await seedBook(env, ID, [{ title: "Uno", words: 200, text }]);
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    expect(mock.calls[0]!.user).toContain("Frase unica di prova sul tema.");
    expect(mock.calls[0]!.system).toContain("Scrivi in italiano");
  });
});

describe("language of the answer", () => {
  it("ends every user prompt with the output language, in Italian for it", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    for (const call of mock.calls) expect(call.user.endsWith("Scrivi il riassunto esclusivamente in italiano.")).toBe(true);
  });

  it("names the language of other codes by code", () => {
    expect(languageInstruction("en")).toBe("Scrivi il riassunto esclusivamente in inglese.");
    expect(languageInstruction("fr-CA")).toBe("Scrivi il riassunto esclusivamente in francese.");
    expect(languageInstruction("ja")).toBe("Write the summary only in the language with code ja.");
  });

  it("retries once when the chapter answer is in the wrong language, then keeps the right one", async () => {
    await seedThreeChapters();
    let englishOnce = false;
    const mock = scriptedModel((call) => {
      if (call.user.includes('Capitolo 2: "Le ore che scivolano"') && !englishOnce) {
        englishOnce = true;
        return ENGLISH;
      }
      return ANSWER;
    });
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 1,
      onProgress: (e) => events.push(e),
    });
    expect(mock.calls.filter((c) => c.user.includes('Capitolo 2: "Le ore che scivolano"'))).toHaveLength(2);
    expect(result.summary.chapters[1]!.summary).toBe(ANSWER);
    expect(events.some((e) => e.kind === "warning")).toBe(false);
  });

  it("keeps a wrong-language summary after the retry and emits a warning instead of failing", async () => {
    await seedThreeChapters();
    const mock = scriptedModel((call) => (call.user.includes('Capitolo 2: "Le ore che scivolano"') ? ENGLISH : ANSWER));
    const events: SummarizeProgress[] = [];
    const result = await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 1,
      onProgress: (e) => events.push(e),
    });
    expect(mock.calls.filter((c) => c.user.includes('Capitolo 2: "Le ore che scivolano"'))).toHaveLength(2);
    expect(result.summary.chapters[1]!.summary).toBe(ENGLISH);
    expect(result.summary.book).toBe(ANSWER);
    const warnings = events.filter((e) => e.kind === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "warning", step: 'capitolo 2 "Le ore che scivolano"' });
  });
});

describe("looksLikeLanguage", () => {
  const IT = "Il capitolo parla del tempo e della memoria, con una storia che si ripete per tutto il libro.";
  const EN = "The chapter is about time and the way that readers are changed by the story of it.";

  it("accepts an Italian text for it and an English text for en", () => {
    expect(looksLikeLanguage(IT, "it")).toBe(true);
    expect(looksLikeLanguage(EN, "en")).toBe(true);
  });

  it("rejects the other language", () => {
    expect(looksLikeLanguage(EN, "it")).toBe(false);
    expect(looksLikeLanguage(IT, "en")).toBe(false);
  });

  it("rejects a short text with fewer than 3 stopwords of the target", () => {
    expect(looksLikeLanguage("Sì.", "it")).toBe(false);
    expect(looksLikeLanguage("Ok, the end.", "en")).toBe(false);
  });

  it("accepts an ambiguous text when the target count is at least the other's (and 3)", () => {
    expect(looksLikeLanguage("the il the il the il", "en")).toBe(true);
    expect(looksLikeLanguage("the il the il the il", "it")).toBe(true);
    expect(looksLikeLanguage("the the the il", "it")).toBe(false);
  });

  it("accepts every text for other languages", () => {
    expect(looksLikeLanguage(EN, "fr")).toBe(true);
    expect(looksLikeLanguage("Sì.", "de")).toBe(true);
  });
});

describe("isFrontOrBackMatter", () => {
  it.each([
    "Cover", "Copertina", "Title Page", "Frontespizio", "Copyright", "Dedication", "Dedica", "Epigraph", "Epigrafe",
    "Contents", "Table of Contents", "Indice", "Sommario", "Index", "Indice analitico", "Indice dei nomi", "Notes",
    "Endnotes", "Note", "Bibliography", "Bibliografia", "References", "Riferimenti bibliografici", "Acknowledgments",
    "Acknowledgements", "Ringraziamenti", "About the Author", "A Note About the Author", "L'autore",
    "Nota sull'autore", "Also By", "Other Titles", "Other Books By", "Dello stesso autore", "Praise For", "Credits",
    "Crediti", "Colophon",
  ])("matches %s", (title) => {
    expect(isFrontOrBackMatter(title)).toBe(true);
  });

  it("ignores case, accents, a leading number or punctuation, and surrounding spaces", () => {
    expect(isFrontOrBackMatter("  NOTES  ")).toBe(true);
    expect(isFrontOrBackMatter("12. Notes")).toBe(true);
    expect(isFrontOrBackMatter("3 - Indice")).toBe(true);
    expect(isFrontOrBackMatter("Indice analìtico")).toBe(true);
    expect(isFrontOrBackMatter("L\u2019autore")).toBe(true);
    expect(isFrontOrBackMatter("Notes.")).toBe(true);
  });

  it.each([
    "About the Author: a short biography",
    "Also by the same author",
    "Praise for the book",
    "Other books by Ada",
    "A note on the text",
  ])("matches the prefix in %s", (title) => {
    expect(isFrontOrBackMatter(title)).toBe(true);
  });

  it.each([
    "Notes on Camp",
    "The Index of Desire",
    "Index cards and memory",
    "Copyright law in the digital age",
    "Credits roll: the last act",
    "Chapter 4: the notes of a traveller",
    "Le ore che scivolano",
    "",
    "   ",
  ])("does not match the real chapter title %j", (title) => {
    expect(isFrontOrBackMatter(title)).toBe(false);
  });
});

describe("summarizeBook front and back matter", () => {
  it("does not call the model for a long Notes chapter, nor for a short one", async () => {
    await seedBook(env, ID, [
      { title: "Notes", words: 5055 },
      { title: "Copyright", words: 184 },
      { title: "Le ore che scivolano", words: 400 },
    ]);
    const mock = scriptedModel(() => ANSWER);
    const result = await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });

    // One chapter call (the real chapter) and one book call.
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls.some((c) => c.user.includes('Capitolo 1: "Notes"'))).toBe(false);
    expect(result.summary.chapters.map((c) => c.summary === null)).toEqual([true, true, false]);
  });

  it("reports the skip reason: front/back matter first, then short", async () => {
    await seedBook(env, ID, [
      { title: "Notes", words: 5055 },
      { title: "Piccolo intermezzo", words: 40 },
      { title: "Le ore che scivolano", words: 400 },
    ]);
    const mock = scriptedModel(() => ANSWER);
    const events: SummarizeProgress[] = [];
    await summarizeBook(deps(mock.model), ID, {
      language: "it",
      concurrency: 1,
      onProgress: (e) => events.push(e),
    });
    const chapters = events.filter((e) => e.kind === "chapter");
    expect(chapters.map((e) => (e.kind === "chapter" ? e.reason : "-"))).toEqual([
      "front-back-matter",
      "short",
      undefined,
    ]);
  });
});

describe("summarizeBook book prompt", () => {
  it("lists the summarized chapter titles in order and forbids invented counts", async () => {
    await seedThreeChapters();
    const mock = scriptedModel(() => ANSWER);
    await summarizeBook(deps(mock.model), ID, { language: "it", concurrency: 1 });
    const bookCall = mock.calls.at(-1)!;
    const first = bookCall.user.indexOf("- Le ore che scivolano");
    const second = bookCall.user.indexOf("- Abitudini");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(bookCall.user).not.toContain("- Copertina");
    expect(bookCall.user).toContain("Non citare numeri di capitoli, pagine o altre cifre");
  });
});
