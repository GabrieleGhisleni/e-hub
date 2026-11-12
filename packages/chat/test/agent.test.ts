// Agent loop with the AI SDK mock model (no HTTP): error hardening, truncation and the step limit.

import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4FinishReason, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, runAgent } from "../src/node/index.ts";

const toolCallsReason: LanguageModelV4FinishReason = { unified: "tool-calls", raw: undefined };
const stopReason: LanguageModelV4FinishReason = { unified: "stop", raw: undefined };

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function toolCallTurn(toolName: string, input: object, id = "call_1"): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    { type: "finish", usage, finishReason: toolCallsReason },
  ];
}

function textTurn(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", usage, finishReason: stopReason },
  ];
}

/** Mock model that plays one stream per call, in order, and records the prompts it received. */
function scriptedModel(turns: LanguageModelV4StreamPart[][]) {
  const prompts: unknown[] = [];
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt);
      const parts = turns[Math.min(call++, turns.length - 1)];
      return { stream: convertArrayToReadableStream(parts) };
    },
  });
  return { model, prompts, calls: () => call };
}

describe("runAgent with the mock model", () => {
  it("turns a throwing tool into an error string, feeds it back and completes the stream", async () => {
    const { model, prompts } = scriptedModel([toolCallTurn("boom", { x: 1 }), textTurn("Ho gestito l'errore")]);

    const result = runAgent({
      model,
      system: "test",
      messages: [{ role: "user", content: "fai" }],
      tools: {
        boom: defineTool({
          inputSchema: z.object({ x: z.number() }),
          execute: async (): Promise<string> => {
            throw new Error("boom");
          },
        }),
      },
    });

    expect(await result.text).toBe("Ho gestito l'errore");
    expect(JSON.stringify(prompts[1])).toContain("Errore del tool: boom");
  });

  it("truncates long string results with a note", async () => {
    const { model, prompts } = scriptedModel([toolCallTurn("big", {}), textTurn("ok")]);

    const result = runAgent({
      model,
      system: "test",
      messages: [{ role: "user", content: "fai" }],
      tools: {
        big: defineTool({
          inputSchema: z.object({}),
          execute: async () => "a".repeat(50_000),
        }),
      },
    });
    await result.text;

    const serialized = JSON.stringify(prompts[1]);
    expect(serialized).toContain("[Risultato troncato: 10000 caratteri in meno]");
    expect(serialized).not.toContain("a".repeat(40_001));
  });

  it("respects the step limit", async () => {
    const execute = vi.fn(async () => "ancora");
    const { model, calls } = scriptedModel([toolCallTurn("loop", {})]);

    const result = runAgent({
      model,
      system: "test",
      messages: [{ role: "user", content: "fai" }],
      maxSteps: 2,
      tools: {
        loop: defineTool({ inputSchema: z.object({}), execute }),
      },
    });
    const steps = await result.steps;

    expect(steps).toHaveLength(2);
    expect(calls()).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
