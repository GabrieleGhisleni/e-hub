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

  it("labels search_book with the query", () => {
    expect(describeToolCall("search_book", { query: "abitudini" })).toBe("Cerca «abitudini»");
  });

  it("labels list_chapters", () => {
    expect(describeToolCall("list_chapters", {})).toBe("Guarda l'indice");
  });

  it("falls back to generic labels while the input is still missing or unknown", () => {
    expect(describeToolCall("read_chapter", undefined)).toBe("Legge un capitolo");
    expect(describeToolCall("search_book", {})).toBe("Cerca nel libro");
    expect(describeToolCall("read_transcript", { from: 0 })).toBe("Strumento: read_transcript");
  });
});
