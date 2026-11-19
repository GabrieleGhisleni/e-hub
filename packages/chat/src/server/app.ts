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
import { SAVE_NOTE_TOOL, saveNoteTool } from "../shared/save-note.ts";
import { describeLlmError } from "./errors.ts";

/** Appended to the system prompt of every source: when to call `save_note`. */
export const SAVE_NOTE_INSTRUCTIONS = [
  "Se l'utente chiede di salvare o aggiungere qualcosa alle note (ad esempio «aggiungilo alle note», «salvalo», «segnatelo»), chiama lo strumento save_note.",
  "Il testo della nota è in Markdown e deve essere autosufficiente: una riga iniziale in grassetto con l'argomento, i concetti chiave in grassetto, elenchi puntati per più punti, il capitolo (cap. N) o la pagina quando li conosci, senza preamboli.",
  "Non salvare note se l'utente non te lo chiede. Non dire mai che una nota è stata salvata, se l'esito dello strumento non lo conferma.",
].join(" ");

/**
 * Appended to the system prompt of every source, last so it wins: the prompts, transcripts, books and notes are in
 * whatever language they were written in, but the reply follows the user's latest message.
 */
export const LANGUAGE_INSTRUCTIONS = [
  "## Lingua della risposta",
  "Rispondi sempre nella lingua dell'ultimo messaggio dell'utente (se scrive in inglese rispondi in inglese, se scrive in italiano in italiano), qualunque sia la lingua di queste istruzioni, della trascrizione, del libro o delle note. Se l'utente cambia lingua, cambia anche tu. Traduci le tue spiegazioni, non le citazioni.",
].join("\n");

/** Estimated tokens of LANGUAGE_INSTRUCTIONS. */
export const LANGUAGE_TOKENS = 80;

/** Estimated tokens of SAVE_NOTE_INSTRUCTIONS and the tool definition, added to each source's `tokens`. */
export const SAVE_NOTE_TOKENS = 250;

/**
 * Appended when the panel is in notes mode ("Appunti"): the user picks replies into a draft of notes, so each reply
 * must read as a note on its own. `save_note` then adds to that draft (the browser decides), it does not save.
 */
export const NOTES_MODE_INSTRUCTIONS = [
  "## Modalità appunti",
  "L'utente sta prendendo appunti: sceglierà quali risposte aggiungere alla sua bozza di appunti, così come sono. Ogni risposta deve quindi reggersi da sola:",
  "- Apri con una riga in grassetto che dice l'argomento (non la domanda).",
  "- Poi uno o due paragrafi brevi di prosa, non elenchi, con i concetti chiave in **grassetto**.",
  "- Indica sempre il capitolo così: (cap. N). Al massimo una citazione breve tra «».",
  "- Niente preamboli, saluti, riassunti della domanda o domande finali.",
  "- Se l'utente chiede di salvare o aggiungere qualcosa, usa save_note: il testo va nella bozza, che l'utente rivede prima di salvarla.",
].join("\n");

/** Estimated tokens of NOTES_MODE_INSTRUCTIONS. */
export const NOTES_MODE_TOKENS = 180;

/** What the chat knows about its source: the system prompt, its size, and optional tools. */
export type ChatSourceContext = {
  system: string;
  /** Estimated tokens of `system` (checked against the budget). */
  tokens: number;
  tools?: ToolSet;
};

export type ChatAppOptions = {
  /** Lazily builds the LLM config (throws AiConfigError when the configuration is missing or invalid). */
  getLlm: () => Llm | Promise<Llm>;
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
  notesMode: z.boolean().optional(),
  rich: z.boolean().optional(),
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
        llm = await getLlm();
      } catch (error) {
        if (error instanceof AiConfigError) {
          return c.json(
            { error: `Chat non configurata: ${error.problems.join("; ")}. Inserisci le tue chiavi in Impostazioni (o, in locale, in .env.local).` },
            503,
          );
        }
        throw error;
      }

      // The save_note tool and its instructions go with every source; the source's own tools win on a name clash.
      const notesMode = body.notesMode === true;
      const tokens = context.tokens + SAVE_NOTE_TOKENS + LANGUAGE_TOKENS + (notesMode ? NOTES_MODE_TOKENS : 0);
      const tools: ToolSet = { [SAVE_NOTE_TOOL]: saveNoteTool, ...context.tools };
      const system = [
        context.system,
        SAVE_NOTE_INSTRUCTIONS,
        ...(notesMode ? [NOTES_MODE_INSTRUCTIONS] : []),
        LANGUAGE_INSTRUCTIONS,
      ].join("\n\n");

      if (!fitsBudget(tokens, llm.config)) {
        const budget = Math.floor(llm.config.maxContextTokens * 0.8);
        return c.json(
          {
            error: `Il contenuto è troppo lungo per il contesto del modello (circa ${tokens} token, budget ${budget}). Il ripiego con i tool non è ancora disponibile.`,
          },
          413,
        );
      }

      const routerInfo: RouterInfo = {};
      // "Feel rich": the same request on the rich model.
      const rich = body.rich === true;
      const { chatModel } = createLlm(rich ? { ...llm.config, model: llm.config.richModel } : llm.config, {
        headers: { "x-router-session": body.id },
        fetch: captureRouterHeaders(routerInfo),
      });

      let modelMessages;
      try {
        modelMessages = await convertToModelMessages(messages, { tools });
      } catch (error) {
        return c.json({ error: "Messaggi non convertibili.", details: [String(error)] }, 400);
      }

      const result = runAgent({
        model: chatModel,
        system,
        messages: modelMessages,
        tools,
        // The router already retries across providers; one more retry here only adds waiting.
        maxRetries: 1,
        // Reasoning off by default (EHUB_AI_REASONING_EFFORT=none): replies start sooner.
        ...(llm.config.reasoningEffort !== undefined ? { reasoningEffort: llm.config.reasoningEffort } : {}),
        abortSignal: c.req.raw.signal,
      });

      // When the client stops the reply, the SDK rejects its result promises (with an undefined reason). Nobody reads
      // them here, and an unhandled rejection kills the dev server: mark them as handled.
      for (const promise of [result.text, result.finishReason, result.usage, result.totalUsage, result.steps, result.response]) {
        Promise.resolve(promise).catch(() => {});
      }

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        messageMetadata: ({ part }) => metadataFor(part, routerInfo),
        onError: (error) => {
          console.error("[chat] LLM call failed", error);
          return describeLlmError(error, {
            baseUrl: llm.config.baseUrl,
            ...(rich ? { richModel: llm.config.richModel } : {}),
          });
        },
      });
    },
  );

  return app;
}
