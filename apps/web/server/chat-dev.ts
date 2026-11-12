/**
 * Chat endpoint for the Vite dev server (mounted by vite.config.ts; never in the production build).
 * The LLM configuration comes from EHUB_AI_* in the repo's .env.local (or the environment).
 * `episode` and `book` sources are wired; exploration sources answer 404 until their phase.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatApp, type ChatSourceContext } from "@ehub/chat/server";
import { createLlm, loadAiConfig, loadDotEnvLocal, type Llm } from "@ehub/chat/node";
import {
  buildEpisodeChatContext,
  NotFoundError,
  ValidationError,
} from "@ehub/podcasts/chat-context";
import { createBookChatSource } from "@ehub/library/chat-context";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnvLocal(repoRoot);

let llm: Llm | undefined;
const bookSource = createBookChatSource();

export default createChatApp({
  // Memoized on success only: a missing configuration is reported on every request until it is fixed.
  getLlm: () => {
    llm ??= createLlm(loadAiConfig());
    return llm;
  },
  resolveSource: async (source): Promise<ChatSourceContext | undefined> => {
    if (source.kind === "book") return bookSource(source.id);
    if (source.kind !== "episode") return undefined;
    try {
      const context = await buildEpisodeChatContext(source.id);
      return { system: context.system, tokens: context.tokens };
    } catch (error) {
      // Unknown or invalid slug, or no local transcript: the source does not exist for the chat.
      if (error instanceof NotFoundError || error instanceof ValidationError) return undefined;
      throw error;
    }
  },
});
