// Rough token estimate and context budget check. Cheap on purpose: no tokenizer.

import type { AiConfig } from "./config.ts";

/** Share of the context window that prompts may fill. */
const BUDGET_SHARE = 0.8;

/** Estimate: words x 1.4. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.4);
}

/** True when `tokens` fits within 80% of the configured context window. */
export function fitsBudget(tokens: number, config: Pick<AiConfig, "maxContextTokens">): boolean {
  return tokens <= config.maxContextTokens * BUDGET_SHARE;
}
