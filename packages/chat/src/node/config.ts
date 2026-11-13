// Runtime configuration of the LLM endpoint, read from environment variables
// (and optionally from the repo's .env.local). Node only: never import from the browser.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export type AiConfig = {
  /** OpenAI-compatible base URL, including `/v1` (e.g. https://host/v1). */
  baseUrl: string;
  apiKey: string;
  /** Model for chat and tool calls. */
  model: string;
  /** Model of the "Feel rich" button in the chat (EHUB_AI_RICH_MODEL, default `gpt-6-luna`). */
  richModel: string;
  /**
   * Reasoning effort sent with the chat calls (`reasoning_effort`). Defaults to `none` (reasoning off: faster replies,
   * no thinking tokens). `undefined` when the variable is `default`: the field is not sent and the router decides.
   */
  reasoningEffort: string | undefined;
  /** Model for chapter and book summaries. Defaults to `fast`. */
  summaryModel: string;
  /**
   * Reasoning effort sent with the summary calls (`reasoning_effort`). Defaults to `none` (reasoning off).
   * `undefined` when the variable is `default`: the field is not sent and the router decides.
   */
  summaryReasoningEffort: string | undefined;
  /** Context window budget in tokens. */
  maxContextTokens: number;
};

export class AiConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid AI configuration: ${problems.join("; ")}`);
    this.name = "AiConfigError";
    this.problems = problems;
  }
}

/**
 * The user's LLM router (freeway, OpenAI-compatible) as published on the Raspberry Pi through a Cloudflare Tunnel.
 * Override with EHUB_AI_BASE_URL (e.g. `http://127.0.0.1:4100/v1` for a router started locally).
 */
export const DEFAULT_AI_BASE_URL = "https://freeway.gabrieleghisleni.dev/v1";

/** Model of the chat's "Feel rich" button: the most capable one on the router (not on freeway yet, coming soon). */
export const DEFAULT_RICH_MODEL = "gpt-6-luna";

const envSchema = z.object({
  EHUB_AI_BASE_URL: z.url({ error: "must be an absolute URL" }).default(DEFAULT_AI_BASE_URL),
  EHUB_AI_API_KEY: z.string(),
  EHUB_AI_MODEL: z.string().default("smart"),
  EHUB_AI_RICH_MODEL: z.string().default(DEFAULT_RICH_MODEL),
  EHUB_AI_REASONING_EFFORT: z.string().optional(),
  EHUB_AI_SUMMARY_MODEL: z.string().optional(),
  EHUB_AI_SUMMARY_REASONING_EFFORT: z.string().optional(),
  EHUB_AI_MAX_CONTEXT_TOKENS: z
    .string()
    .regex(/^\d+$/, { error: "must be a positive integer" })
    .transform(Number)
    .pipe(z.number().int().positive({ error: "must be a positive integer" }))
    .optional(),
});

/**
 * Validates the EHUB_AI_* variables. Empty values count as unset.
 * Throws AiConfigError listing every missing or invalid variable.
 */
export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== "") cleaned[key] = value.trim();
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = String(issue.path[0]);
      return cleaned[name] === undefined ? `${name} is missing` : `${name} ${issue.message}`;
    });
    throw new AiConfigError(problems);
  }

  const data = parsed.data;
  const effort = (value: string | undefined) => {
    const resolved = value ?? "none";
    return resolved === "default" ? undefined : resolved;
  };
  const reasoningEffort = data.EHUB_AI_SUMMARY_REASONING_EFFORT ?? "none";
  return {
    baseUrl: data.EHUB_AI_BASE_URL,
    apiKey: data.EHUB_AI_API_KEY,
    model: data.EHUB_AI_MODEL,
    richModel: data.EHUB_AI_RICH_MODEL,
    reasoningEffort: effort(data.EHUB_AI_REASONING_EFFORT),
    summaryModel: data.EHUB_AI_SUMMARY_MODEL ?? "fast",
    summaryReasoningEffort: reasoningEffort === "default" ? undefined : reasoningEffort,
    maxContextTokens: data.EHUB_AI_MAX_CONTEXT_TOKENS ?? 1_000_000,
  };
}

/**
 * Loads `<repoRoot>/.env.local` into `env` (process.env by default).
 * KEY=VALUE lines; blank lines and `#` comments are skipped; matching
 * surrounding quotes are stripped. Variables already set (non-empty) are never overridden.
 * A missing file is not an error.
 */
export function loadDotEnvLocal(repoRoot: string, env: Record<string, string | undefined> = process.env): void {
  const file = join(repoRoot, ".env.local");
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
}
