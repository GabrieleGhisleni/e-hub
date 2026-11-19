import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { BookDetail } from "@shared/schema.ts";
import { BookAdminActions } from "@library/admin/book-admin-actions.tsx";
import { bookChatSuggestions } from "@library/admin/book-chat.tsx";

const book = {
  id: "eec5cpre",
  slug: "pensieri-lenti",
  title: "Pensieri lenti e veloci",
  authors: ["Daniel Kahneman", "Amos Tversky"],
  topic: "psicologia",
  status: "read",
  tags: ["bias", "decisioni"],
  coverUrl: null,
  notesHtml: null,
  recallHtml: null,
  studyHtml: null,
  summary: null,
} as unknown as BookDetail;

describe("book admin actions", () => {
  it("renders the Chatta button next to the other admin buttons", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(BookAdminActions, { book, index: undefined, placement: "toolbar" }),
      ),
    );
    expect(html).toContain("Chatta");
    expect(html).toContain("Modifica");
    expect(html).toContain("Opzioni del libro");
  });
});

describe("bookChatSuggestions", () => {
  it("names the first tag in the second suggestion", () => {
    expect(bookChatSuggestions(book)).toEqual([
      "Di cosa parla il libro, in breve?",
      "Quali capitoli dovrei leggere se mi interessa bias?",
      "Qual è la tesi più discutibile?",
      "Cosa ho sottolineato finora?",
      "Scrivi gli appunti del libro a partire dalle mie sottolineature",
    ]);
  });

  it("uses the first subject when there are no tags, and a generic phrase when there is neither", () => {
    expect(bookChatSuggestions({ tags: [], subjects: ["economia"] })[1]).toBe(
      "Quali capitoli dovrei leggere se mi interessa economia?",
    );
    expect(bookChatSuggestions({ tags: [] })[1]).toBe(
      "Quali capitoli dovrei leggere se mi interessa un tema del libro?",
    );
  });
});
