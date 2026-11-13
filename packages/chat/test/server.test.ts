// POST /api/chat over HTTP mock: stream content and metadata, session header, and the error responses.

import { afterEach, describe, expect, it } from "vitest";
import { createChatApp, type ChatSourceContext } from "../src/server/app.ts";
import { createLlm, loadAiConfig } from "../src/node/index.ts";
import type { ChatRequestBody } from "../src/shared/types.ts";
import { startMockLlm, type MockLlm } from "@ehub/chat/testing";

let mock: MockLlm | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const ROUTER_HEADERS = {
  "x-router-model": "smart-07",
  "x-router-provider": "mock-provider",
  "x-router-tier": "smart",
};

const sources: Record<string, ChatSourceContext> = {
  "episode:ok": { system: "Sei un assistente di test.", tokens: 100 },
  "episode:huge": { system: "Enorme.", tokens: 1_000_000 },
};

function appFor(baseURL: string, config: Record<string, string | undefined> = { EHUB_AI_BASE_URL: baseURL, EHUB_AI_API_KEY: "test-key" }) {
  return createChatApp({
    getLlm: () => createLlm(loadAiConfig(config)),
    resolveSource: async (source) => sources[`${source.kind}:${source.id}`],
  });
}

function body(overrides: Partial<ChatRequestBody> = {}): ChatRequestBody {
  return {
    id: "conv-1",
    source: { kind: "episode", id: "ok" },
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Di cosa parla?" }] }],
    ...overrides,
  };
}

function post(app: ReturnType<typeof createChatApp>, payload: unknown) {
  return app.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

/** Parses the UI message stream (SSE of JSON chunks) into its chunks. */
function parseChunks(text: string): any[] {
  return text
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice("data: ".length)));
}

describe("POST /api/chat", () => {
  it("streams the reply with the router metadata on the assistant message", async () => {
    mock = await startMockLlm([{ text: "Parla di matematica." }], { responseHeaders: ROUTER_HEADERS });
    const response = await post(appFor(mock.baseURL), body());

    expect(response.status).toBe(200);
    const chunks = parseChunks(await response.text());
    const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(text).toBe("Parla di matematica.");

    const finish = chunks.find((c) => c.type === "finish");
    expect(finish.messageMetadata).toMatchObject({
      model: "smart-07",
      provider: "mock-provider",
      tier: "smart",
      totalTokens: 15,
    });
  });

  it("sends the conversation id as x-router-session and the system prompt of the source", async () => {
    mock = await startMockLlm([{ text: "ok" }]);
    await (await post(appFor(mock.baseURL), body({ id: "conv-42" }))).text();

    expect(mock.requestHeaders[0]!["x-router-session"]).toBe("conv-42");
    expect(mock.requests[0].messages[0]).toMatchObject({ role: "system" });
    expect(mock.requests[0].messages[0].content).toMatch(/^Sei un assistente di test\.\n\n/);
    expect(mock.requests[0].messages.at(-1)).toMatchObject({ role: "user", content: "Di cosa parla?" });
    // Reasoning is off by default for the chat.
    expect(mock.requests[0].reasoning_effort).toBe("none");
  });

  it("adds the notes-mode instructions only when notesMode is on", async () => {
    mock = await startMockLlm([{ text: "ok" }, { text: "ok" }]);
    await (await post(appFor(mock.baseURL), body())).text();
    await (await post(appFor(mock.baseURL), body({ notesMode: true }))).text();
    expect(mock.requests[0].messages[0].content).not.toContain("Modalità appunti");
    expect(mock.requests[1].messages[0].content).toContain("## Modalità appunti");
    expect(mock.requests[1].messages[0].content).toContain("(cap. N)");
  });

  it("uses the rich model with rich: true, the default one otherwise", async () => {
    mock = await startMockLlm([{ text: "ok" }, { text: "ok" }]);
    await (await post(appFor(mock.baseURL), body())).text();
    await (await post(appFor(mock.baseURL), body({ rich: true }))).text();
    expect(mock.requests[0].model).toBe("smart");
    expect(mock.requests[1].model).toBe("gpt-6-luna");
  });

  it("says the rich model is not on the router yet when the router does not know it", async () => {
    mock = await startMockLlm([{ status: 404, body: { error: { message: "unknown model gpt-6-luna" } } }]);
    const response = await post(appFor(mock.baseURL), body({ rich: true }));
    const chunks = parseChunks(await response.text());
    expect(chunks.find((c) => c.type === "error")?.errorText).toBe(
      "Il modello di «Feel rich» (gpt-6-luna) non è ancora disponibile sul router: disattiva Feel rich per usare quello di sempre.",
    );
  });

  it("returns 400 for a body that does not match the contract", async () => {
    const response = await post(appFor("http://unused.test/v1"), { id: "", source: { kind: "movie", id: "x" }, messages: [] });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBeTruthy();
    expect(json.details.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await post(appFor("http://unused.test/v1"), "{not json");
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown source", async () => {
    const response = await post(appFor("http://unused.test/v1"), body({ source: { kind: "episode", id: "missing" } }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("episode 'missing'");
  });

  it("returns 413 when the source does not fit the context budget, without calling the model", async () => {
    mock = await startMockLlm([{ text: "non dovrebbe arrivare" }]);
    const response = await post(appFor(mock.baseURL), body({ source: { kind: "episode", id: "huge" } }));

    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("troppo lungo");
    expect(mock.requests).toHaveLength(0);
  });

  it("streams the Italian message when the model is busy (503 after the SDK retries)", async () => {
    const busy = {
      status: 503,
      // retry-after-ms 0 keeps the SDK's retry delay at zero; the message reads the router's retry_in_seconds.
      headers: { "retry-after-ms": "0" },
      body: {
        error: { message: "every matching endpoint is cooling down", type: "all_providers_busy", retry_in_seconds: 78, tried: [] },
      },
    };
    // The chat runs with maxRetries: 1, so the mock answers two attempts.
    mock = await startMockLlm([busy, busy]);
    const response = await post(appFor(mock.baseURL), body());

    expect(response.status).toBe(200);
    const chunks = parseChunks(await response.text());
    const error = chunks.find((c) => c.type === "error");
    expect(error?.errorText).toBe(
      "Il modello non è disponibile in questo momento (limiti dei piani gratuiti). Riprova tra 78 secondi.",
    );
  }, 5_000);

  it("streams the Italian message for a rejected API key without retrying", async () => {
    mock = await startMockLlm([{ status: 401, body: { error: { message: "invalid api key" } } }]);
    const response = await post(appFor(mock.baseURL), body());

    const chunks = parseChunks(await response.text());
    expect(chunks.find((c) => c.type === "error")?.errorText).toBe(
      "Chiave API non valida: controlla EHUB_AI_API_KEY in .env.local.",
    );
    expect(mock.requests).toHaveLength(1);
  });

  it("returns 503 with the config problems when the configuration is missing", async () => {
    const response = await post(appFor("http://unused.test/v1", {}), body());

    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).toContain("Chat non configurata");
    expect(error).toContain("EHUB_AI_API_KEY is missing");
    expect(error).toContain(".env.example");
  });
});
