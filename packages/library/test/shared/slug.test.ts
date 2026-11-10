import { describe, expect, it } from "vitest";
import { authorSurname, bookSlug } from "../../src/shared/slug.ts";

describe("bookSlug", () => {
  it("joins the first author's surname and the title", () => {
    expect(bookSlug({ title: "Thinking, Fast and Slow", authors: ["Daniel Kahneman"] })).toBe(
      "kahneman-thinking-fast-and-slow",
    );
    expect(
      bookSlug({ title: "Sapiens: Da animali a dèi", authors: ["Yuval Noah Harari", "X"] }),
    ).toBe("harari-sapiens-da-animali-a-dei");
  });
  it("is bounded and never empty", () => {
    expect(bookSlug({ title: "parola ".repeat(50), authors: ["A B"] }).length).toBeLessThanOrEqual(
      80,
    );
    expect(bookSlug({ title: "日本", authors: ["村上"] })).toBe("libro");
  });
});

describe("authorSurname", () => {
  it.each([
    ["Daniel Kahneman", "Kahneman"],
    ["Kahneman, Daniel", "Kahneman"],
    ["Ludwig van Beethoven", "van Beethoven"],
    ["Leonardo Da Vinci", "Da Vinci"],
    ["Martin Luther King Jr.", "King"],
    ["Omero", "Omero"],
    ["", ""],
  ])("%s → %s", (author, surname) => {
    expect(authorSurname(author)).toBe(surname);
  });
});
