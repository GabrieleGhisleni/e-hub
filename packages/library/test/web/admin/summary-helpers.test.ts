import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../../src/web/admin/lib/errors.ts";
import {
  summaryDoneText,
  summaryFailure,
  summaryLanguageOptions,
} from "../../../src/web/admin/lib/summary.ts";

const response = {
  summary: {
    version: 1 as const,
    bookId: "eec5cpre",
    generatedAt: "2026-11-12T10:00:00.000Z",
    model: "smart",
    language: "en",
    book: "Book.",
    chapters: [{ n: 1, title: "One", words: 900, summary: "Chapter one." }],
  },
  summarizedChapters: 1,
  durationMs: 95_400,
};

describe("summary helpers (admin)", () => {
  it("offers Italian and English, plus the book language when it is different", () => {
    expect(summaryLanguageOptions(undefined).map((o) => o.value)).toEqual(["it", "en"]);
    expect(summaryLanguageOptions("en-US").map((o) => o.value)).toEqual(["it", "en"]);
    expect(summaryLanguageOptions("it").map((o) => o.value)).toEqual(["it", "en"]);
    const french = summaryLanguageOptions("fr");
    expect(french.map((o) => o.value)).toEqual(["it", "en", "fr"]);
    expect(french[2]?.label).toBe("Francese");
  });

  it("describes the finished run", () => {
    expect(summaryDoneText(response)).toBe("Sintesi generata: 1 capitolo in 95s");
    expect(summaryDoneText({ ...response, summarizedChapters: 12, durationMs: 40_000 })).toBe(
      "Sintesi generata: 12 capitoli in 40s",
    );
  });

  it("adds the config hint only for ai-not-configured", () => {
    const notConfigured = new ApiRequestError({
      status: 503,
      code: "ai-not-configured",
      message: "Il modello IA non è configurato.",
    });
    expect(summaryFailure(notConfigured)).toEqual({
      message: "Il modello IA non è configurato.",
      hint: "Configura EHUB_AI_* in .env.local.",
    });
    const busy = new ApiRequestError({
      status: 409,
      code: "busy",
      message: "Un altro processo sta scrivendo.",
    });
    expect(summaryFailure(busy)).toEqual({
      message: "Un altro processo sta scrivendo.",
      hint: null,
    });
  });
});
