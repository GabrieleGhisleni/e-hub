import { describe, expect, it } from "vitest";
import {
  BOOK_ID_PATTERN,
  CROCKFORD_ALPHABET,
  generateBookId,
  isBookId,
  isTopicId,
  topicIdFromLabel,
} from "../../src/shared/ids.ts";

describe("generateBookId", () => {
  it("returns 8 lowercase Crockford base32 characters", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateBookId(new Set());
      expect(id).toMatch(BOOK_ID_PATTERN);
      expect(isBookId(id)).toBe(true);
    }
  });

  it("uses the whole alphabet and never i, l, o, u", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const ch of generateBookId(new Set())) seen.add(ch);
    expect([...seen].sort().join("")).toBe(CROCKFORD_ALPHABET);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ilou]/);
  });

  it("is deterministic with an injected rng and skips taken IDs", () => {
    const sequence = (values: number[]) => {
      let i = 0;
      return () => values[i++ % values.length] ?? 0;
    };
    const first = generateBookId(new Set(), sequence([0]));
    expect(first).toBe("00000000");
    // First attempt yields 00000000 (taken), the second yields 11111111.
    const rng = sequence([...Array(8).fill(0), ...Array(8).fill(1 / 32)]);
    expect(generateBookId(new Set(["00000000"]), rng)).toBe("11111111");
    expect(generateBookId(new Set(), () => 0.999999)).toBe("zzzzzzzz");
  });

  it("throws when the rng can never produce a free ID", () => {
    expect(() => generateBookId(new Set(["00000000"]), () => 0)).toThrow(/1000 attempts/);
  });
});

describe("isBookId", () => {
  it.each(["7k2m9q4t", "00000000", "zzzzzzzz"])("accepts %s", (id) => {
    expect(isBookId(id)).toBe(true);
  });
  it.each([
    "7K2M9Q4T",
    "7k2m9q4",
    "7k2m9q4tt",
    "7k2m9q4i",
    "7k2m9q4o",
    "7k2m9q4u",
    "../books",
    "",
    12345678,
  ])("rejects %s", (id) => {
    expect(isBookId(id)).toBe(false);
  });
});

describe("topicIdFromLabel", () => {
  it("slugs the label in ASCII", () => {
    expect(topicIdFromLabel("Storia antica", [])).toBe("storia-antica");
    expect(topicIdFromLabel("Filosofia & Società", [])).toBe("filosofia-societa");
    expect(topicIdFromLabel("  L'età dell'oro  ", [])).toBe("l-eta-dell-oro");
    expect(topicIdFromLabel("Straße", [])).toBe("strasse");
  });

  it("deduplicates against existing IDs", () => {
    expect(topicIdFromLabel("Narrativa", ["narrativa"])).toBe("narrativa-2");
    expect(topicIdFromLabel("Narrativa", new Set(["narrativa", "narrativa-2"]))).toBe(
      "narrativa-3",
    );
    expect(topicIdFromLabel("Unsorted", ["unsorted"])).toBe("unsorted-2");
  });

  it("falls back to 'topic' when nothing is left", () => {
    expect(topicIdFromLabel("???", [])).toBe("topic");
    expect(topicIdFromLabel("日本", ["topic"])).toBe("topic-2");
  });

  it("always produces a valid topic id, even for long labels", () => {
    const id = topicIdFromLabel(
      "Una categoria con un nome davvero molto lungo per essere un argomento",
      [],
    );
    expect(isTopicId(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(48);
    expect(
      isTopicId(
        topicIdFromLabel(
          "x".repeat(100),
          Array.from({ length: 10 }, (_, i) => (i ? `${"x".repeat(44)}-${i + 1}` : "x".repeat(44))),
        ),
      ),
    ).toBe(true);
  });
});
