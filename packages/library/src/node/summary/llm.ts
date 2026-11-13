/**
 * Where the summary model comes from at run time: the `.env.local` of the monorepo (and of this package), read into
 * the environment, then `loadAiConfig` + `createLlm` from `@ehub/chat/node`. Node only.
 */
import path from "node:path";
import {
  AiConfigError,
  type LanguageModel,
  createLlm,
  loadAiConfig,
  loadDotEnvLocal,
} from "@ehub/chat/node";
import { REPO_ROOT } from "../config/index.ts";

/** Monorepo root (`packages/library` → `../..`): `.env.local` lives there, next to `.env.example`. */
export const MONOREPO_ROOT = path.resolve(REPO_ROOT, "..", "..");

export interface SummaryModel {
  model: LanguageModel;
  /** The configured summary model id (fallback for `summary.model`). */
  configuredModel: string;
  /** Reasoning effort for the summary calls; `undefined` means the field is not sent. */
  reasoningEffort?: string;
  /** Parallel model calls per summary, from `EHUB_AI_SUMMARY_CONCURRENCY`; `undefined` means the default. */
  concurrency?: number;
}

/** Most parallel model calls per summary (`EHUB_AI_SUMMARY_CONCURRENCY`). */
export const MAX_SUMMARY_CONCURRENCY = 8;

/** Loads `.env.local` (monorepo root first, then the package) into `env`. Never overrides set variables. */
export function loadLocalEnv(env: NodeJS.ProcessEnv = process.env): void {
  loadDotEnvLocal(MONOREPO_ROOT, env);
  loadDotEnvLocal(REPO_ROOT, env);
}

/** Summary model from the EHUB_AI_* variables in `env`. Throws `AiConfigError` when they are missing or invalid. */
export function summaryModelFromEnv(env: NodeJS.ProcessEnv = process.env): SummaryModel {
  const config = loadAiConfig(env);
  const concurrency = summaryConcurrencyFromEnv(env);
  return {
    model: createLlm(config).summaryModel,
    configuredModel: config.summaryModel,
    ...(config.summaryReasoningEffort !== undefined ? { reasoningEffort: config.summaryReasoningEffort } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
  };
}

/**
 * `EHUB_AI_SUMMARY_CONCURRENCY` as a number (an integer from 1 to `MAX_SUMMARY_CONCURRENCY`), `undefined` when unset or
 * blank. Throws `AiConfigError` when it is not such an integer.
 */
export function summaryConcurrencyFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.EHUB_AI_SUMMARY_CONCURRENCY?.trim();
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > MAX_SUMMARY_CONCURRENCY) {
    throw new AiConfigError([
      `EHUB_AI_SUMMARY_CONCURRENCY deve essere un intero tra 1 e ${MAX_SUMMARY_CONCURRENCY} (letto: "${raw}")`,
    ]);
  }
  return value;
}
