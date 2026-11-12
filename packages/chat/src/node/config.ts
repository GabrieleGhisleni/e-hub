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
  /** Model for chapter and book summaries. Defaults to `model`. */
  summaryModel: string;
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

const envSchema = z.object({
  EHUB_AI_BASE_URL: z.url({ error: "must be an absolute URL" }),
  EHUB_AI_API_KEY: z.string(),
  EHUB_AI_MODEL: z.string().default("smart"),
  EHUB_AI_SUMMARY_MODEL: z.string().optional(),
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
  const model = data.EHUB_AI_MODEL;
  return {
    baseUrl: data.EHUB_AI_BASE_URL,
    apiKey: data.EHUB_AI_API_KEY,
    model,
    summaryModel: data.EHUB_AI_SUMMARY_MODEL ?? model,
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
