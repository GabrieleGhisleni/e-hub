// POST /api/chat sends the save_note tool and its instructions with every source, and streams its calls to the client.

import { tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatApp, LANGUAGE_INSTRUCTIONS, type ChatSourceContext } from "../src/server/app.ts";
import { createLlm, loadAiConfig } from "../src/node/index.ts";
import type { ChatRequestBody } from "../src/shared/types.ts";
import { startMockLlm, type MockLlm } from "@ehub/chat/testing";

let mock: MockLlm | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const sources: Record<string, ChatSourceContext> = {
  "episode:ok": { system: "Sei un assistente di test.", tokens: 100 },
  "book:own": {
    system: "Sei un assistente di test.",
    tokens: 100,
    tools: {
      read_chapter: tool({
        description: "Legge un capitolo.",
        inputSchema: z.object({ chapter: z.number() }),
        execute: async () => "testo",
      }),
    },
  },
  "episode:huge": { system: "Enorme.", tokens: 1_000_000 },
};

function appFor(baseURL: string) {
  return createChatApp({
    getLlm: () => createLlm(loadAiConfig({ EHUB_AI_BASE_URL: baseURL, EHUB_AI_API_KEY: "test-key" })),
    resolveSource: async (source) => sources[`${source.kind}:${source.id}`],
  });
}

function body(overrides: Partial<ChatRequestBody> = {}): ChatRequestBody {
  return {
    id: "conv-1",
    source: { kind: "episode", id: "ok" },
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Aggiungilo alle note." }] }],
    ...overrides,
  };
}

function post(app: ReturnType<typeof appFor>, payload: unknown) {
  return app.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function toolNames(request: any): string[] {
  return (request.tools ?? []).map((tool: any) => tool.function.name);
}

describe("save_note on POST /api/chat", () => {
  it("sends the save_note tool and the system paragraph with every source", async () => {
    mock = await startMockLlm([{ text: "Fatto." }]);
    await (await post(appFor(mock.baseURL), body())).text();

    const request = mock.requests[0];
    expect(toolNames(request)).toEqual(["save_note"]);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toMatch(/^Sei un assistente di test\.\n\n/);
    expect(request.messages[0].content).toContain("save_note");
    expect(request.messages[0].content).toContain("«aggiungilo alle note»");
  });

  it("ends the system prompt of every source with the reply-language rule", async () => {
    mock = await startMockLlm([{ text: "Done." }]);
    await (await post(appFor(mock.baseURL), body())).text();

    const system: string = mock.requests[0].messages[0].content;
    expect(system.endsWith(LANGUAGE_INSTRUCTIONS)).toBe(true);
    expect(system).toContain("lingua dell'ultimo messaggio dell'utente");
  });

  it("keeps the source's own tools next to save_note", async () => {
    mock = await startMockLlm([{ text: "Fatto." }]);
    await (await post(appFor(mock.baseURL), body({ source: { kind: "book", id: "own" } }))).text();

    expect(toolNames(mock.requests[0]).sort()).toEqual(["read_chapter", "save_note"]);
  });

  it("streams a save_note call to the client without executing it on the server", async () => {
    mock = await startMockLlm([{ toolCalls: [{ name: "save_note", arguments: { text: "Una nota." } }] }]);
    const text = await (await post(appFor(mock.baseURL), body())).text();

    const events = text
      .split("\n\n")
      .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
      .map((event) => JSON.parse(event.slice("data: ".length)));
    const call = events.find((event) => event.type === "tool-input-available");
    expect(call).toMatchObject({ toolName: "save_note", input: { text: "Una nota." } });
    expect(events.some((event) => event.type === "tool-output-available")).toBe(false);
  });

  it("counts the save_note tokens against the budget", async () => {
    mock = await startMockLlm([{ text: "ok" }]);
    // 1_000_000 is over the budget on its own; a source just under the budget must fail once the extra tokens are added.
    const near = { system: "Quasi pieno.", tokens: 0 } as ChatSourceContext;
    const config = loadAiConfig({ EHUB_AI_BASE_URL: mock.baseURL, EHUB_AI_API_KEY: "test-key" });
    const limit = Math.floor(config.maxContextTokens * 0.8);
    sources["episode:near"] = { ...near, tokens: limit - 10 };

    const response = await post(appFor(mock.baseURL), body({ source: { kind: "episode", id: "near" } }));
    expect(response.status).toBe(413);
    expect(mock.requests).toHaveLength(0);
    delete sources["episode:near"];
  });
});
