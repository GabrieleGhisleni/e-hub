import { createChatApp, type ChatSourceContext } from "@ehub/chat/server";
import { createLlm, loadAiConfig, type Llm } from "@ehub/chat/node";
import { userEnv } from "@ehub/store";
import { buildEpisodeChatContext, NotFoundError, ValidationError } from "@ehub/podcasts/chat-context";
import { listItemNotes } from "@ehub/notes/node";
import { createBookChatSource } from "@ehub/library/chat-context";
import { createExplorationChatSource } from "@ehub/explore/chat";
import type { MiddlewareHandler } from "hono";

/** The chat: same sources as the dev server (book, exploration, episode). LLM settings are the personal ones of the user. */
export function createChat(options: { getLlm?: () => Llm | Promise<Llm>; access?: MiddlewareHandler } = {}) {
  const bookSource = createBookChatSource();
  const explorationSource = createExplorationChatSource();
  return createChatApp({
    // The LLM is the one of the user of the request (their own keys, see @ehub/store user-settings): not memoized.
    getLlm: options.getLlm ?? (async () => createLlm(loadAiConfig(await userEnv()))),
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
