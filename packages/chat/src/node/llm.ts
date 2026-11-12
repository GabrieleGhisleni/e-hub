// Builds the chat and summary language models on the OpenAI-compatible provider of the Vercel AI SDK.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AiConfig } from "./config.ts";

export type Llm = {
  chatModel: LanguageModel;
  summaryModel: LanguageModel;
  config: AiConfig;
};

/** Per-provider options: extra request headers and a custom fetch (e.g. to read the router's response headers). */
export type LlmOptions = {
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
};

export function createLlm(config: AiConfig, options: LlmOptions = {}): Llm {
  const provider = createOpenAICompatible({
    name: "ehub",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    headers: options.headers,
    fetch: options.fetch,
  });
  return {
    chatModel: provider(config.model),
    summaryModel: provider(config.summaryModel),
    config,
  };
}
