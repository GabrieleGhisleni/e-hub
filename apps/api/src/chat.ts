import { createChatApp, type ChatSourceContext } from "@ehub/chat/server";
import { createLlm, loadAiConfig, type Llm } from "@ehub/chat/node";
import { buildEpisodeChatContext, NotFoundError, ValidationError } from "@ehub/podcasts/chat-context";
import { listItemNotes } from "@ehub/notes/node";
import { createBookChatSource } from "@ehub/library/chat-context";
import { createExplorationChatSource } from "@ehub/explore/chat";
import type { MiddlewareHandler } from "hono";

/** The chat: same sources as the dev server (book, exploration, episode). LLM settings come from EHUB_AI_*. */
export function createChat(options: { getLlm?: () => Llm; access?: MiddlewareHandler } = {}) {
  let llm: Llm | undefined;
  const bookSource = createBookChatSource();
  const explorationSource = createExplorationChatSource();
  return createChatApp({
    getLlm:
      options.getLlm ??
      (() => {
        llm ??= createLlm(loadAiConfig());
        return llm;
      }),
    resolveSource: async (source): Promise<ChatSourceContext | undefined> => {
      if (source.kind === "book") {
        const threadNotes = await listItemNotes("library", source.id).catch(() => []);
        return bookSource(source.id, { threadNotes });
      }
      if (source.kind === "exploration") return explorationSource(source.id);
      if (source.kind !== "episode") return undefined;
      try {
        const threadNotes = await listItemNotes("podcasts", source.id).catch(() => []);
        const context = await buildEpisodeChatContext(source.id, { threadNotes });
        return { system: context.system, tokens: context.tokens, tools: context.tools };
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof ValidationError) return undefined;
        throw error;
      }
    },
  });
}
