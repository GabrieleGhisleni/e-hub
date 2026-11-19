/**
 * Chat endpoint for the Vite dev server (mounted by vite.config.ts; never in the production build).
 * The LLM configuration comes from EHUB_AI_* in the repo's .env.local (or the environment).
 * `episode`, `book` and `exploration` sources are wired; a missing source answers 404.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatApp, type ChatSourceContext } from "@ehub/chat/server";
import { createLlm, loadAiConfig, loadDotEnvLocal } from "@ehub/chat/node";
import { userEnv } from "@ehub/store";
import {
  buildEpisodeChatContext,
  NotFoundError,
  ValidationError,
} from "@ehub/podcasts/chat-context";
import { listItemNotes } from "@ehub/notes/node";
import { createBookChatSource } from "@ehub/library/chat-context";
import { createExplorationChatSource } from "@ehub/explore/chat";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnvLocal(repoRoot);

const bookSource = createBookChatSource();
const explorationSource = createExplorationChatSource();

export default createChatApp({
  // Personal settings (Impostazioni) over .env.local; read on every request so a change applies at once.
  getLlm: async () => createLlm(loadAiConfig(await userEnv())),
  resolveSource: async (source): Promise<ChatSourceContext | undefined> => {
    if (source.kind === "book") {
      // The notes thread of the page is read on every request, so the chat sees notes added after it opened.
      const threadNotes = await listItemNotes("library", source.id).catch(() => []);
      return bookSource(source.id, { threadNotes });
    }
    if (source.kind === "exploration") return explorationSource(source.id);
    if (source.kind !== "episode") return undefined;
    try {
      // The notes thread of the page is read on every request, so the chat sees notes added after it opened.
      const threadNotes = await listItemNotes("podcasts", source.id).catch(() => []);
      const context = await buildEpisodeChatContext(source.id, { threadNotes });
      return { system: context.system, tokens: context.tokens, tools: context.tools };
    } catch (error) {
      // Unknown or invalid slug, or no local transcript: the source does not exist for the chat.
      if (error instanceof NotFoundError || error instanceof ValidationError) return undefined;
      throw error;
    }
  },
});
