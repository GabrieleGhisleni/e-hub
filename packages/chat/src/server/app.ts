// Chat endpoint: POST /api/chat. Node only (dev server). Body: ChatRequestBody; response: AI SDK UI message stream.
//
// The model is built per request: the header `x-router-session` keeps the conversation on the same router model,
// and a wrapped fetch reads the router's `x-router-model`, `x-router-provider` and `x-router-tier` response headers.

import { convertToModelMessages, type TextStreamPart, type ToolSet } from "ai";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AiConfigError, createLlm, fitsBudget, runAgent, type Llm } from "../node/index.ts";
import {
  CHAT_API_PATH,
  type ChatMessageMetadata,
  type ChatRequestBody,
  type ChatSource,
  type ChatUIMessage,
} from "../shared/types.ts";
import { describeLlmError } from "./errors.ts";

/** What the chat knows about its source: the system prompt, its size, and optional tools. */
export type ChatSourceContext = {
  system: string;
  /** Estimated tokens of `system` (checked against the budget). */
  tokens: number;
  tools?: ToolSet;
};

export type ChatAppOptions = {
  /** Lazily builds the LLM config (throws AiConfigError when the configuration is missing or invalid). */
  getLlm: () => Llm;
  /** Resolves the source; returns undefined when it does not exist (404). */
  resolveSource: (source: ChatSource) => Promise<ChatSourceContext | undefined>;
};

/** Body limit for POST /api/chat. */
export const CHAT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/** Max length of a conversation ID (also sent to the router as x-router-session). */
const ID_MAX_LENGTH = 200;

const BodySchema = z.object({
  id: z.string().min(1).max(ID_MAX_LENGTH),
  source: z.object({
    kind: z.enum(["episode", "book", "exploration"]),
    id: z.string().min(1).max(ID_MAX_LENGTH),
  }),
  messages: z.array(
    z.looseObject({
      role: z.enum(["system", "user", "assistant"]),
      parts: z.array(z.looseObject({ type: z.string() })),
    }),
  ),
});

type StreamPart = TextStreamPart<ToolSet>;

type RouterInfo = Pick<ChatMessageMetadata, "model" | "provider" | "tier">;

/** Copies the router headers of each response into `info`; the fetch itself is unchanged. */
function captureRouterHeaders(info: RouterInfo): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    info.model = response.headers.get("x-router-model") ?? info.model;
    info.provider = response.headers.get("x-router-provider") ?? info.provider;
    info.tier = response.headers.get("x-router-tier") ?? info.tier;
    return response;
  };
}

/**
 * Metadata for the `start` and `finish` parts: the router headers known so far, plus the token total on `finish`.
 * Undefined for other parts, and when nothing is known yet.
 */
function metadataFor(part: StreamPart, info: RouterInfo): ChatMessageMetadata | undefined {
  if (part.type !== "start" && part.type !== "finish") return undefined;
  const metadata: ChatMessageMetadata = { ...info };
  if (part.type === "finish" && part.totalUsage.totalTokens !== undefined) {
    metadata.totalTokens = part.totalUsage.totalTokens;
  }
  const definedFields = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return definedFields.length > 0 ? Object.fromEntries(definedFields) : undefined;
}

export function createChatApp({ getLlm, resolveSource }: ChatAppOptions) {
  const app = new Hono();

  app.onError((error, c) => {
    console.error("[chat]", error);
    return c.json({ error: error.message }, 500);
  });

  app.post(
    CHAT_API_PATH,
    bodyLimit({
      maxSize: CHAT_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: "Messaggio troppo grande (limite 2 MB)." }, 413),
    }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: "Il corpo della richiesta non è JSON valido." }, 400);
      }
      const parsed = BodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          {
            error: "Richiesta non valida.",
            details: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
          },
          400,
        );
      }
      const body = parsed.data as unknown as ChatRequestBody;
      const messages = body.messages as unknown as ChatUIMessage[];

      const context = await resolveSource(body.source);
      if (!context) return c.json({ error: `Fonte non trovata: ${body.source.kind} '${body.source.id}'.` }, 404);

      let llm: Llm;
      try {
        llm = getLlm();
      } catch (error) {
        if (error instanceof AiConfigError) {
          return c.json(
            { error: `Chat non configurata: ${error.problems.join("; ")}. Copia .env.example in .env.local.` },
            503,
          );
        }
        throw error;
      }

      if (!fitsBudget(context.tokens, llm.config)) {
        const budget = Math.floor(llm.config.maxContextTokens * 0.8);
        return c.json(
          {
            error: `Il contenuto è troppo lungo per il contesto del modello (circa ${context.tokens} token, budget ${budget}). Il ripiego con i tool non è ancora disponibile.`,
          },
          413,
        );
      }

      const routerInfo: RouterInfo = {};
      const { chatModel } = createLlm(llm.config, {
        headers: { "x-router-session": body.id },
        fetch: captureRouterHeaders(routerInfo),
      });

      let modelMessages;
      try {
        modelMessages = await convertToModelMessages(messages, { tools: context.tools });
      } catch (error) {
        return c.json({ error: "Messaggi non convertibili.", details: [String(error)] }, 400);
      }

      const result = runAgent({
        model: chatModel,
        system: context.system,
        messages: modelMessages,
        tools: context.tools,
        // The router already retries across providers; one more retry here only adds waiting.
        maxRetries: 1,
        abortSignal: c.req.raw.signal,
      });

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        messageMetadata: ({ part }) => metadataFor(part, routerInfo),
        onError: (error) => {
          console.error("[chat] LLM call failed", error);
          return describeLlmError(error, { baseUrl: llm.config.baseUrl });
        },
      });
    },
  );

  return app;
}
