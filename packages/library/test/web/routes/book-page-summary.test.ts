import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { BookDetail, SiteIndex } from "@shared/schema.ts";

// Admin code is not part of this test: the book page only reads the flag.
vi.hoisted(() => {
  (globalThis as { __ELIB_ADMIN__?: boolean }).__ELIB_ADMIN__ = false;
});

const detail = { value: null as BookDetail | null };
const index = { value: null as SiteIndex | null };

// The page reads its data from the site-data store (fetch + effects): serve it from the test instead.
vi.mock("@library/data/site-data.ts", () => ({
  useBookDetail: () => {
    const data = detail.value ?? undefined;
    return {
      state: data ? { status: "ready", data, refreshing: false } : { status: "loading" },
      data,
      retry: () => undefined,
    };
  },
  useSiteIndex: () => {
    const data = index.value ?? undefined;
    return {
      state: data ? { status: "ready", data, refreshing: false } : { status: "loading" },
      data,
      retry: () => undefined,
    };
  },
  findCard: (idx: SiteIndex | undefined, id: string) => idx?.books.find((b) => b.id === id),
  topicLabel: (idx: SiteIndex, topic: string) =>
    idx.topics.find((t) => t.id === topic)?.label ?? topic,
  prefetchBook: () => undefined,
}));

const { BookPage } = await import("@library/routes/book-page.tsx");

const ID = "eec5cpre";
const SLUG = "libro-di-prova";

function baseBook(extra: Partial<BookDetail> = {}): BookDetail {
  return {
    id: ID,
    slug: SLUG,
    title: "Libro di prova",
    authors: ["Autore Uno"],
    topic: "unsorted",
    status: "read",
    tags: [],
    coverUrl: null,
    notesHtml: null,
    recallHtml: null,
    studyHtml: null,
    summary: null,
    ...extra,
  } as BookDetail;
}

const idx: SiteIndex = {
  topics: [{ id: "unsorted", label: "Da smistare" }],
  books: [
    {
      id: ID,
      slug: SLUG,
      title: "Libro di prova",
      authors: ["Autore Uno"],
      topic: "unsorted",
      status: "read",
      tags: [],
      coverUrl: null,
    },
  ],
};

function render(book: BookDetail): string {
  detail.value = book;
  index.value = idx;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/book/${ID}/${SLUG}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/book/:id/:slug", element: createElement(BookPage) }),
      ),
    ),
  );
}

describe("book page: Sintesi section", () => {
  const summary = {
    language: "it",
    model: "smart",
    generatedAt: "2026-11-12T10:00:00.000Z",
    book: "Primo paragrafo della sintesi.\n\nSecondo paragrafo del libro.",
    chapters: [
      { n: 1, title: "Introduzione", summary: "Riassunto dell'introduzione." },
      { n: 2, title: "Copertina", summary: null },
      { n: 3, title: "Il metodo", summary: "Riassunto del metodo." },
    ],
  };

  it("renders the book summary, the summarized chapters and the footer line", () => {
    const html = render(baseBook({ summary }));

    expect(html).toContain('id="sintesi"');
    expect(html).toContain("Primo paragrafo della sintesi.");
    expect(html).toContain("Secondo paragrafo del libro.");
    expect(html).toContain("Introduzione");
    expect(html).toContain("Riassunto dell&#x27;introduzione.");
    expect(html).toContain("Il metodo");
    expect(html).toContain("Sintesi generata da smart il 12 novembre 2026</p>");
  });

  it("hides chapters without a summary", () => {
    const html = render(baseBook({ summary }));
    expect(html).not.toContain(">Copertina<");
    expect(html).toContain(">Introduzione<");
  });

  it("lists the section in the in-page navigation, before the other sections", () => {
    const html = render(
      baseBook({ summary, recallHtml: "<p>Ricordare questo.</p>", studyHtml: "<p>Studio.</p>" }),
    );
    const nav = html.slice(html.indexOf('aria-label="In questa pagina"'));
    const sintesiAt = nav.indexOf('href="#sintesi"');
    expect(sintesiAt).toBeGreaterThan(-1);
    expect(sintesiAt).toBeLessThan(nav.indexOf('href="#da-ricordare"'));
    expect(sintesiAt).toBeLessThan(nav.indexOf('href="#studio"'));
    expect(html.indexOf('id="sintesi"')).toBeLessThan(html.indexOf("Ricordare questo."));
  });

  it("uses a native collapsible per chapter, closed by default", () => {
    const html = render(baseBook({ summary }));
    const details = html.match(/<details[^>]*>/g) ?? [];
    expect(details).toHaveLength(2);
    for (const tag of details) expect(tag).not.toContain("open");
    // Two chapters: no expand-all toggle.
    expect(html).not.toContain("Espandi tutto");
  });

  it("shows the expand-all toggle above three summarized chapters", () => {
    const many = {
      ...summary,
      chapters: [1, 2, 3, 4].map((n) => ({ n, title: `Capitolo ${n}`, summary: `Testo ${n}.` })),
    };
    const html = render(baseBook({ summary: many }));
    expect(html).toContain("Espandi tutto");
    expect(html).toContain("Capitolo 4");
  });

  it("adds the language when it is not Italian", () => {
    const html = render(baseBook({ summary: { ...summary, language: "en" } }));
    expect(html).toContain("Sintesi generata da smart il 12 novembre 2026 in Inglese</p>");
  });

  it("renders no section when the book has no summary", () => {
    const html = render(baseBook({ summary: null, recallHtml: "<p>Ricordare.</p>" }));
    expect(html).not.toContain('id="sintesi"');
    expect(html).not.toContain("Sintesi generata");
    expect(html).not.toContain('href="#sintesi"');
    expect(html).toContain("Ricordare.");
  });
});
