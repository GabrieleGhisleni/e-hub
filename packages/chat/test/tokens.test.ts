// Token estimate and budget check.

import { describe, expect, it } from "vitest";
import { estimateTokens, fitsBudget } from "../src/node/index.ts";

describe("estimateTokens", () => {
  it("is words x 1.4, rounded up", () => {
    expect(estimateTokens("uno due tre")).toBe(5); // 3 * 1.4 = 4.2
    expect(estimateTokens("  uno\n\ndue\ttre  ")).toBe(5);
    expect(estimateTokens("una")).toBe(2); // 1.4 -> 2
  });

  it("is zero for empty text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });
});

describe("fitsBudget", () => {
  const config = { maxContextTokens: 1_000_000 };

  it("accepts up to 80% of the context window", () => {
    expect(fitsBudget(800_000, config)).toBe(true);
    expect(fitsBudget(800_001, config)).toBe(false);
  });

  it("scales with the configured window", () => {
    expect(fitsBudget(4_000, { maxContextTokens: 5_000 })).toBe(true);
    expect(fitsBudget(4_001, { maxContextTokens: 5_000 })).toBe(false);
  });
});
