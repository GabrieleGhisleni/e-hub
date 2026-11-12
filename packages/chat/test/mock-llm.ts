// Fake OpenAI-compatible server for tests: POST /v1/chat/completions with scripted turns.
// Each request consumes the next turn; every request body is recorded in `requests`.

import { Hono } from "hono";
import type { Server } from "node:http";
import { serve, type ServerType } from "@hono/node-server";

export type MockToolCall = { name: string; arguments: Record<string, unknown> };
export type MockTurn = { text: string } | { toolCalls: MockToolCall[] };

export type MockLlm = {
  /** Base URL including `/v1`, ready for EHUB_AI_BASE_URL. */
  baseURL: string;
  /** Parsed JSON bodies of the requests received, in order. */
  requests: any[];
  /** Request headers (lower-case names) of each request, in order. */
  requestHeaders: Record<string, string>[];
  close(): Promise<void>;
};

export type MockLlmOptions = {
  /** Extra headers sent on every response (e.g. the router's `x-router-model`). */
  responseHeaders?: Record<string, string>;
};

export async function startMockLlm(turns: MockTurn[], options: MockLlmOptions = {}): Promise<MockLlm> {
  const requests: any[] = [];
  const requestHeaders: Record<string, string>[] = [];
  let next = 0;
  const extraHeaders = options.responseHeaders ?? {};

  const app = new Hono();
  app.post("/v1/chat/completions", async (c) => {
    requestHeaders.push(Object.fromEntries(c.req.raw.headers));
    const body = await c.req.json();
    requests.push(body);

    const turn = turns[next++];
    if (!turn) return c.json({ error: { message: "mock: no scripted turn left" } }, 500, extraHeaders);

    if (body.stream) {
      return c.body(streamBody(turn), 200, { "content-type": "text/event-stream", ...extraHeaders });
    }
    return c.json(completionBody(turn, body.model), 200, extraHeaders);
  });

  const server: ServerType = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  const port = await new Promise<number>((resolve) => {
    if (server.listening) resolve((server.address() as { port: number }).port);
    else server.once("listening", () => resolve((server.address() as { port: number }).port));
  });

  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    requestHeaders,
    close: () =>
      new Promise<void>((resolve, reject) => {
        (server as Server).closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

function completionBody(turn: MockTurn, model: string) {
  const base = { id: "chatcmpl-mock", object: "chat.completion", created: 0, model: model ?? "smart", usage };
  if ("text" in turn) {
    return { ...base, choices: [{ index: 0, message: { role: "assistant", content: turn.text }, finish_reason: "stop" }] };
  }
  const tool_calls = turn.toolCalls.map((call, index) => ({
    id: `call_${index}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  return {
    ...base,
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls }, finish_reason: "tool_calls" }],
  };
}

/** SSE body with `chat.completion.chunk` events, ending with `data: [DONE]`. */
function streamBody(turn: MockTurn): string {
  const events: unknown[] = [];
  const chunk = (delta: unknown, finish_reason: string | null = null) => ({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 0,
    model: "smart",
    choices: [{ index: 0, delta, finish_reason }],
  });

  events.push(chunk({ role: "assistant", content: "" }));
  if ("text" in turn) {
    // Split the text in two deltas so the client has to concatenate them.
    const mid = Math.ceil(turn.text.length / 2);
    for (const piece of [turn.text.slice(0, mid), turn.text.slice(mid)]) {
      if (piece) events.push(chunk({ content: piece }));
    }
    events.push(chunk({}, "stop"));
  } else {
    turn.toolCalls.forEach((call, index) => {
      events.push(
        chunk({ tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name: call.name, arguments: "" } }] }),
      );
      // Arguments arrive in at least two deltas.
      const args = JSON.stringify(call.arguments);
      const mid = Math.ceil(args.length / 2);
      for (const part of [args.slice(0, mid), args.slice(mid)]) {
        events.push(chunk({ tool_calls: [{ index, function: { arguments: part } }] }));
      }
    });
    events.push(chunk({}, "tool_calls"));
  }
  events.push({ ...chunk({}), choices: [], usage });

  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}
