// Agent loop on top of the AI SDK: streamText with tools and a step limit.
// The SDK runs the tool-calling loop; this file only hardens the tools
// (errors and oversized results become strings the model can read).

import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

/** Maximum length of a string tool result fed back to the model. */
const MAX_TOOL_RESULT_CHARS = 40_000;

/** Declares a tool. Re-export of the AI SDK `tool` helper, for the source modules. */
export const defineTool = tool;

export type RunAgentOptions = {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  /** Maximum number of model calls in one run (tool round trips included). */
  maxSteps?: number;
  abortSignal?: AbortSignal;
};

/**
 * Streams a reply from `model`, letting it call `tools` for up to `maxSteps` steps.
 * Returns the AI SDK stream result (textStream, fullStream, toUIMessageStreamResponse, ...).
 */
export function runAgent({ model, system, messages, tools = {}, maxSteps = 8, abortSignal }: RunAgentOptions) {
  return streamText({
    model,
    system,
    messages,
    tools: hardenTools(tools, abortSignal),
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
  });
}

/**
 * Wraps each tool's execute: a thrown error becomes the string "Errore del tool: <message>",
 * and a string result longer than MAX_TOOL_RESULT_CHARS is cut with a note.
 * Aborts (the client stopped the reply) are rethrown so the run ends instead of feeding the model an error.
 */
function hardenTools(tools: ToolSet, abortSignal?: AbortSignal): ToolSet {
  const hardened: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    if (!("execute" in definition) || typeof definition.execute !== "function") {
      hardened[name] = definition;
      continue;
    }
    const execute = definition.execute;
    hardened[name] = {
      ...definition,
      execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
        try {
          const output = await execute(input, options);
          return typeof output === "string" ? truncate(output) : output;
        } catch (error) {
          if (abortSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
          return `Errore del tool: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    } as ToolSet[string];
  }
  return hardened;
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Risultato troncato: ${text.length - MAX_TOOL_RESULT_CHARS} caratteri in meno]`;
}
