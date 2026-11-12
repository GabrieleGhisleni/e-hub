import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPaths } from "@shared/api.ts";
import { adminApi } from "@library/admin/api.ts";
import { ApiRequestError } from "@library/admin/lib/errors.ts";
import { summaryFailure } from "@library/admin/lib/summary.ts";
import {
  SUMMARY_BUSY_TEXT,
  SummarizeForm,
  type SummarizeFormProps,
} from "@library/admin/summarize-book-dialog.tsx";

const ID = "eec5cpre";

const response = {
  summary: {
    version: 1,
    bookId: ID,
    generatedAt: "2026-11-12T10:00:00.000Z",
    model: "smart",
    language: "en",
    book: "Book.",
    chapters: [{ n: 1, title: "One", words: 900, summary: "Chapter one." }],
  },
  summarizedChapters: 1,
  durationMs: 95_400,
};

describe("summarizeBook (admin API client)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs { language, force } to the summary endpoint", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    const result = await adminApi.summarizeBook(ID, { language: "en", force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(apiPaths.bookSummary(ID));
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ language: "en", force: true });
    expect(result.summarizedChapters).toBe(1);
  });

  it("rejects with the server's Italian message and code", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "ai-not-configured", message: "Il modello IA non è configurato." },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await adminApi
      .summarizeBook(ID, { language: "it", force: false })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("ai-not-configured");
    expect(summaryFailure(error)).toEqual({
      message: "Il modello IA non è configurato.",
      hint: "Configura EHUB_AI_* in .env.local.",
    });
  });

  it("gives no config hint for other errors", () => {
    const failure = summaryFailure(
      new ApiRequestError({
        status: 409,
        code: "busy",
        message: "Un altro processo sta scrivendo.",
      }),
    );
    expect(failure).toEqual({ message: "Un altro processo sta scrivendo.", hint: null });
  });
});

describe("SummarizeForm", () => {
  const base: SummarizeFormProps = {
    options: [
      { value: "it", label: "Italiano" },
      { value: "en", label: "Inglese" },
    ],
    language: "it",
    onLanguageChange: () => undefined,
    force: false,
    onForceChange: () => undefined,
    busy: false,
    failure: null,
    hasSummary: false,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  };

  it("offers the force checkbox and a Genera button when there is no summary yet", () => {
    const html = renderToStaticMarkup(createElement(SummarizeForm, base));
    expect(html).toContain("Rigenera anche il testo");
    expect(html).toContain("Genera</button>");
    expect(html).not.toContain(SUMMARY_BUSY_TEXT);
    expect(html).not.toContain('role="alert"');
  });

  it("shows the spinner text and disables the button while running", () => {
    const html = renderToStaticMarkup(
      createElement(SummarizeForm, { ...base, busy: true, hasSummary: true }),
    );
    expect(html).toContain("Sto generando la sintesi… può richiedere qualche minuto");
    expect(html).toContain("Generazione…");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg/);
  });

  it("shows the error message and the config hint", () => {
    const html = renderToStaticMarkup(
      createElement(SummarizeForm, {
        ...base,
        hasSummary: true,
        failure: {
          message: "Il modello IA non è configurato.",
          hint: "Configura EHUB_AI_* in .env.local.",
        },
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Il modello IA non è configurato.");
    expect(html).toContain("Configura EHUB_AI_* in .env.local.");
    expect(html).toContain("Rigenera</button>");
  });
});
