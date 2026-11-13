/**
 * Contract shared by the chat server (`@ehub/chat/server`) and the chat panel (`@ehub/chat/web`).
 * Isomorphic: no Node or DOM APIs.
 *
 *   POST /api/chat   body: ChatRequestBody   → AI SDK UI message stream (assistant messages carry ChatMessageMetadata)
 */
import type { UIMessage } from "ai";

/** What the chat is about. `id` is the book ID, the episode slug or the exploration ID. */
export type ChatSource =
  | { kind: "episode"; id: string }
  | { kind: "book"; id: string }
  | { kind: "exploration"; id: string };

/** Metadata the server attaches to each assistant message (shown under the reply when present). */
export type ChatMessageMetadata = {
  /** Model that actually answered (router header `x-router-model`), when the endpoint reports it. */
  model?: string;
  /** Provider behind the model (router header `x-router-provider`). */
  provider?: string;
  /** Tier that served the request (router header `x-router-tier`), e.g. "smart" or a downgrade like "balanced". */
  tier?: string;
  /** Total tokens used by the reply, when the endpoint reports usage. */
  totalTokens?: number;
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

export type ChatRequestBody = {
  /** Conversation ID chosen by the client; also sent to the router as `x-router-session`. */
  id: string;
  messages: ChatUIMessage[];
  source: ChatSource;
  /** Notes mode ("Appunti"): every reply is written to go into the user's notes as it is. */
  notesMode?: boolean;
  /** "Feel rich": answer with the rich model (`EHUB_AI_RICH_MODEL`, default gpt-6-luna) instead of the default one. */
  rich?: boolean;
};

export const CHAT_API_PATH = "/api/chat";

// The save_note tool, shared by the server (tool definition) and the web (handling the call).
export * from "./save-note";
