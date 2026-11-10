import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_TONES,
  bookHref,
  booksCount,
  formatAuthors,
  formatDate,
  formatLanguage,
  paragraphs,
  placeholderTone,
  resultCountLabel,
} from "../../src/web/lib/format.ts";

describe("format", () => {
  it("formats ISO dates in Italian without timezone drift", () => {
    expect(formatDate("2025-03-04")).toBe("4 marzo 2025");
    expect(formatDate("2024-12-31")).toBe("31 dicembre 2024");
    expect(formatDate("2024-01-01")).toBe("1 gennaio 2024");
    expect(formatDate("not a date")).toBe("not a date");
  });
  it("joins authors the Italian way", () => {
    expect(formatAuthors([])).toBe("");
    expect(formatAuthors(["Dante Alighieri"])).toBe("Dante Alighieri");
    expect(formatAuthors(["A", "B"])).toBe("A e B");
    expect(formatAuthors(["A", "B", "C"])).toBe("A, B e C");
  });
  it("names languages in Italian", () => {
    expect(formatLanguage("it")).toBe("Italiano");
    expect(formatLanguage("en")).toBe("Inglese");
    expect(formatLanguage("la")).toBe("Latino");
    expect(formatLanguage("")).toBe("");
    expect(formatLanguage("not a tag!")).toBe("not a tag!");
  });
  it("pluralizes counts", () => {
    expect(booksCount(1)).toBe("1 libro");
    expect(booksCount(0)).toBe("0 libri");
    expect(resultCountLabel(16, 16)).toBe("16 libri");
    expect(resultCountLabel(3, 16)).toBe("3 di 16 libri");
    expect(resultCountLabel(0, 1)).toBe("0 di 1 libro");
  });
  it("splits descriptions into paragraphs", () => {
    expect(paragraphs("Uno\ncontinua.\n\n  Due.  \n\n\n")).toEqual(["Uno continua.", "Due."]);
    expect(paragraphs("   ")).toEqual([]);
  });
  it("picks a stable placeholder tone", () => {
    const tone = placeholderTone("abcd1234");
    expect(tone).toBe(placeholderTone("abcd1234"));
    expect(tone).toBeGreaterThanOrEqual(0);
    expect(tone).toBeLessThan(PLACEHOLDER_TONES);
  });
  it("builds book paths with the slug when present", () => {
    expect(bookHref({ id: "abcd1234", slug: "dante-commedia" })).toBe(
      "/book/abcd1234/dante-commedia",
    );
    expect(bookHref({ id: "abcd1234", slug: "" })).toBe("/book/abcd1234");
  });
});
