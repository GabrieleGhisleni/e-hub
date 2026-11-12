// Provider integration through the HTTP mock: plain generation, streaming, and a tool round trip via runAgent.

import { generateText, streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, defineTool, loadAiConfig, runAgent } from "../src/node/index.ts";
import { startMockLlm, type MockLlm } from "@ehub/chat/testing";

let mock: MockLlm;

afterEach(async () => {
  await mock?.close();
});

function llmFor(baseURL: string) {
  return createLlm(loadAiConfig({ EHUB_AI_BASE_URL: baseURL, EHUB_AI_API_KEY: "test-key" }));
}

describe("provider over HTTP", () => {
  it("generateText returns the scripted text and sends the model id", async () => {
    mock = await startMockLlm([{ text: "Ciao dal mock" }]);
    const { chatModel } = llmFor(mock.baseURL);

    const result = await generateText({ model: chatModel, prompt: "Ciao" });

    expect(result.text).toBe("Ciao dal mock");
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].model).toBe("smart");
    expect(mock.requests[0].messages.at(-1)).toMatchObject({ role: "user", content: "Ciao" });
  });

  it("streamText yields the text deltas", async () => {
    mock = await startMockLlm([{ text: "Risposta in streaming" }]);
    const { chatModel } = llmFor(mock.baseURL);

    const result = streamText({ model: chatModel, prompt: "Ciao" });
    const deltas: string[] = [];
    for await (const delta of result.textStream) deltas.push(delta);

    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join("")).toBe("Risposta in streaming");
    expect(mock.requests[0].stream).toBe(true);
  });

  it("runAgent runs a 2-step tool call: the tool gets parsed args and the result goes back to the model", async () => {
    mock = await startMockLlm([
      { toolCalls: [{ name: "get_time", arguments: { timezone: "Europe/Rome" } }] },
      { text: "Sono le dodici" },
    ]);
    const { chatModel } = llmFor(mock.baseURL);
    const execute = vi.fn(async ({ timezone }: { timezone: string }) => `2026-11-12T12:00 ${timezone}`);

    const result = runAgent({
      model: chatModel,
      system: "Sei un assistente.",
      messages: [{ role: "user", content: "Che ore sono?" }],
      tools: {
        get_time: defineTool({
          description: "Current time in a timezone",
          inputSchema: z.object({ timezone: z.string() }),
          execute,
        }),
      },
    });
    const text = await result.text;

    expect(text).toBe("Sono le dodici");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ timezone: "Europe/Rome" });

    expect(mock.requests).toHaveLength(2);
    const toolMessage = mock.requests[1].messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMessage.tool_call_id).toBe("call_0");
    expect(JSON.stringify(toolMessage.content)).toContain("2026-11-12T12:00 Europe/Rome");
  });
});
