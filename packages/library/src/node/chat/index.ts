/**
 * Chat source of a book (docs/chat.md §3, source `book`): the system prompt with the metadata and the chapter summaries,
 * and the tools that read the text. Node only; used by the dev chat server (apps/web/server/chat-dev.ts).
 *
 * The text is loaded lazily: opening the chat does not touch Drive, the first tool that needs the text does, and the
 * text is then kept in memory for the life of the source.
 */
import type { ChatSourceContext } from "@ehub/chat/server";
import { estimateTokens } from "@ehub/chat/node";
import { createDriveContext, type DriveContext } from "../drive/index.ts";
import { loadConfig } from "../config/index.ts";
import {
  BookNotFoundError,
  InvalidBookIdError,
  assertBookId,
  readBook,
  readBookSummary,
} from "../repo/index.ts";
import type { TextManifest } from "../text/index.ts";
import { renderBookPrompt } from "./prompt.ts";
import { type BookText, loadBookText, readCachedManifest } from "./text.ts";
import { bookTools } from "./tools.ts";

export type { BookText } from "./text.ts";

/** Dependencies, all optional (tests inject fakes; the defaults read elib.config.json and the local cache). */
export type BookChatDeps = {
  /** Absolute `data/` dir. Default: the configured one. */
  dataDir?: string;
  /** Drive context for the text cache (default: built from the configuration). */
  drive?: DriveContext;
  /** Loads the text of a book (default: `elib text` cache, extracting it when missing). */
  getBookText?: (id: string) => Promise<BookText>;
  /** The cached manifest of a book, without downloading (default: read from the text cache). */
  readCachedManifest?: (id: string) => Promise<TextManifest | undefined>;
};

/** Resolves a book ID to its chat context; undefined when the book does not exist or the ID is invalid. */
export type BookChatSource = (id: string) => Promise<ChatSourceContext | undefined>;

export function createBookChatSource(deps: BookChatDeps = {}): BookChatSource {
  let defaults: { dataDir: string; drive: DriveContext } | undefined;
  /** Built on first use, once: the configuration is read only when a default is needed. */
  const defaultsFromConfig = () => {
    if (defaults === undefined) {
      const config = loadConfig();
      defaults = { dataDir: config.dataDir, drive: createDriveContext(config) };
    }
    return defaults;
  };

  const texts = new Map<string, Promise<BookText>>();
  const textOf = (id: string): Promise<BookText> => {
    let text = texts.get(id);
    if (text === undefined) {
      const load =
        deps.getBookText ?? ((bookId: string) => loadBookText(defaultsFromConfig().drive, bookId));
      text = load(id);
      texts.set(id, text);
      // A failed load is not kept: the next tool call tries again.
      text.catch(() => texts.delete(id));
    }
    return text;
  };

  return async (id) => {
    try {
      assertBookId(id);
    } catch (error) {
      if (error instanceof InvalidBookIdError) return undefined;
      throw error;
    }
    const dataDir = deps.dataDir ?? defaultsFromConfig().dataDir;
    let book;
    try {
      book = await readBook(dataDir, id);
    } catch (error) {
      if (error instanceof BookNotFoundError) return undefined;
      throw error;
    }

    const summary = await readBookSummary(dataDir, id);
    const manifest = summary
      ? undefined
      : await (
          deps.readCachedManifest ??
          ((bookId: string) => readCachedManifest(defaultsFromConfig().drive.cacheDir, bookId))
        )(id);

    const system = renderBookPrompt({ book, summary, chapters: manifest?.chapters });
    const tools = bookTools({ language: book.language, summary, loadText: () => textOf(id) });
    return { system, tokens: estimateTokens(system), tools };
  };
}
