import { describe, expect, it } from "vitest";
import { describeToolCall } from "../../src/web/tool-labels.ts";

describe("describeToolCall", () => {
  it("labels read_chapter with the chapter number", () => {
    expect(describeToolCall("read_chapter", { chapter: 3 })).toBe("Legge il capitolo 3");
  });

  it("adds the part only from the second one on", () => {
    expect(describeToolCall("read_chapter", { chapter: 3, part: 1 })).toBe("Legge il capitolo 3");
    expect(describeToolCall("read_chapter", { chapter: 3, part: 2 })).toBe("Legge il capitolo 3 (parte 2)");
  });

  it("labels search_book with the query, across all books when no book is named", () => {
    expect(describeToolCall("search_book", { query: "abitudini" })).toBe("Cerca «abitudini»");
  });

  it("labels list_chapters", () => {
    expect(describeToolCall("list_chapters", {})).toBe("Guarda l'indice");
  });

  it("names the book of a multi-book tool call after the label", () => {
    expect(describeToolCall("read_chapter", { book: "k3m9x2pq", chapter: 3 })).toBe(
      "Legge il capitolo 3 (libro k3m9x2pq)",
    );
    expect(describeToolCall("read_chapter", { book: "k3m9x2pq", chapter: 3, part: 2 })).toBe(
      "Legge il capitolo 3 (parte 2) (libro k3m9x2pq)",
    );
    expect(describeToolCall("list_chapters", { book: "k3m9x2pq" })).toBe("Guarda l'indice (libro k3m9x2pq)");
    expect(describeToolCall("search_book", { book: "k3m9x2pq", query: "x" })).toBe(
      "Cerca «x» (libro k3m9x2pq)",
    );
  });

  it("says that search_book without a book searches all books", () => {
    expect(describeToolCall("search_book", { query: "x" })).toBe("Cerca «x»");
    expect(describeToolCall("search_book", { query: "x", book: "  " })).toBe("Cerca «x»");
    expect(describeToolCall("search_book", {})).toBe("Cerca nel libro");
    expect(describeToolCall("search_book", { book: "k3m9x2pq" })).toBe("Cerca nel libro (libro k3m9x2pq)");
  });

  it("labels save_note the same while running and when done", () => {
    expect(describeToolCall("save_note", { text: "Una nota" })).toBe("Salva una nota");
    expect(describeToolCall("save_note", undefined)).toBe("Salva una nota");
  });

  it("labels propose_verdicts", () => {
    expect(describeToolCall("propose_verdicts", { verdicts: [] })).toBe("Propone i verdetti");
  });

  it("falls back to generic labels while the input is still missing or unknown", () => {
    expect(describeToolCall("read_chapter", undefined)).toBe("Legge un capitolo");
    expect(describeToolCall("search_book", undefined)).toBe("Cerca nel libro");
    expect(describeToolCall("read_transcript", { from: 0 })).toBe("Strumento: read_transcript");
  });
});
