/**
 * Chat source of an exploration (docs/chat.md, source `exploration`): the system prompt with the question, the books
 * and their summaries, the notes and the journal, plus the multi-book reading tools and `propose_verdicts`. Node only;
 * used by the dev chat server (apps/web/server/chat-dev.ts).
 *
 * Text is loaded lazily: opening the chat reads the exploration and the summaries, the first tool that needs the text
 * of a book loads it, and the text is then kept in memory for the life of the source (like the book source).
 */
import type { ChatSourceContext } from "@ehub/chat/server";
import { defineTool, estimateTokens, type ToolSet } from "@ehub/chat/node";
import {
  type BookSummary,
  type BookText,
  type TextManifest,
  type TextOrigin,
  loadExploreBookText,
  loadLibraryBookText,
  multiBookTools,
  readCachedBookManifest,
  readLibraryBookSummary,
} from "@ehub/library/explore";
import { ExploreError, readExploration } from "../node/repo.ts";
import { ExplorationId, type BookSource, type Exploration } from "../schema.ts";
import { NOTEBOOK_PROPOSAL_MESSAGE, ProposeNotebookInput } from "./notebook.ts";
import { PROPOSAL_ACCEPTED_MESSAGE, ProposeVerdictsInput, checkVerdictProposal } from "./proposal.ts";
import { type PromptBook, renderExplorationPrompt } from "./prompt.ts";

export type { BookText };

/** Dependencies, all optional: the defaults read the explorations on disk and the library facade. */
export type ExplorationChatDeps = {
  readExploration: (id: string) => Promise<Exploration>;
  /** `summary.json` of a library book, or null. Never called for explore books. */
  readLibraryBookSummary: (id: string) => Promise<BookSummary | null>;
  /** The cached manifest of a book, without downloading. */
  readCachedBookManifest: (origin: TextOrigin, id: string) => Promise<TextManifest | undefined>;
  /** The text of a book (library: may download the EPUB; explore: cache only). */
  loadBookText: (origin: TextOrigin, id: string) => Promise<BookText>;
};

export const defaultExplorationChatDeps: ExplorationChatDeps = {
  readExploration,
  readLibraryBookSummary: (id) => readLibraryBookSummary(id),
  readCachedBookManifest: (origin, id) => readCachedBookManifest(origin, id),
  loadBookText: (origin, id) =>
    origin === "library" ? loadLibraryBookText(id) : loadExploreBookText(id),
};

/** Resolves an exploration ID to its chat context; undefined when the ID is invalid or the exploration is missing. */
export type ExplorationChatSource = (id: string) => Promise<ChatSourceContext | undefined>;

export function createExplorationChatSource(
  overrides: Partial<ExplorationChatDeps> = {},
): ExplorationChatSource {
  const deps: ExplorationChatDeps = { ...defaultExplorationChatDeps, ...overrides };

  /** Text per book, memoized for the life of the source; a failed load is not kept, so the next call retries. */
  const texts = new Map<string, Promise<BookText>>();
  const textOf = (source: BookSource): Promise<BookText> => {
    const key = `${source.origin}:${source.id}`;
    let text = texts.get(key);
    if (text === undefined) {
      text = deps.loadBookText(source.origin, source.id);
      texts.set(key, text);
      text.catch(() => texts.delete(key));
    }
    return text;
  };

  return async (id) => {
    if (!ExplorationId.safeParse(id).success) return undefined;
    let exploration: Exploration;
    try {
      exploration = await deps.readExploration(id);
    } catch (error) {
      if (error instanceof ExploreError && (error.code === "not-found" || error.code === "invalid-input")) {
        return undefined;
      }
      throw error;
    }

    const books = await Promise.all(
      exploration.sources.map(async (source): Promise<PromptBook> => {
        const summary =
          source.origin === "library" ? await deps.readLibraryBookSummary(source.id) : null;
        const chapters = summary
          ? undefined
          : (await deps.readCachedBookManifest(source.origin, source.id))?.chapters;
        return { source, summary, chapters };
      }),
    );

    const system = renderExplorationPrompt(exploration, books);
    const tools: ToolSet = {
      ...multiBookTools(
        books.map(({ source, summary }) => ({
          id: source.id,
          title: source.title,
          ...(source.language !== undefined ? { language: source.language } : {}),
          summary,
          loadText: () => textOf(source),
        })),
      ),
      propose_verdicts: proposeVerdictsTool(exploration.sources),
      propose_notebook: proposeNotebookTool(),
    };
    return { system, tokens: estimateTokens(system), tools };
  };
}

/**
 * `propose_verdicts`: checks the proposal against the sources and answers. It never saves: the web UI shows the
 * proposal and the user confirms it there.
 */
function proposeVerdictsTool(sources: BookSource[]) {
  return defineTool({
    description:
      "Propone i verdetti di lettura per i libri dell'esplorazione (uno per libro), e facoltativamente una sintesi e una voce di diario. Non salva nulla: l'utente rivede la proposta e la conferma. Usalo quando l'utente chiede di chiudere l'esplorazione o di decidere cosa leggere.",
    inputSchema: ProposeVerdictsInput,
    execute: (input) => {
      const problems = checkVerdictProposal(input, sources);
      if (problems.length > 0) {
        return [
          "La proposta non è valida:",
          ...problems.map((problem) => `- ${problem}`),
          "Correggi la proposta e chiama di nuovo propose_verdicts.",
        ].join("\n");
      }
      return PROPOSAL_ACCEPTED_MESSAGE;
    },
  });
}

/**
 * `propose_notebook`: checks the new text of the notebook and answers. It never saves: the web UI shows the text and
 * the user decides whether it replaces the notebook.
 */
function proposeNotebookTool() {
  return defineTool({
    description:
      "Propone il testo completo di un nuovo Quaderno dell'esplorazione, da usare per riorganizzare, riscrivere, condensare o correggere quello attuale. Non salva nulla: l'utente rivede il testo e decide se sostituire il Quaderno. Per aggiungere in fondo, usa save_note.",
    inputSchema: ProposeNotebookInput,
    execute: (input) => {
      const parsed = ProposeNotebookInput.safeParse(input);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "formato non valido";
        return `Il quaderno proposto non è valido: ${message}. Correggi la proposta e chiama di nuovo propose_notebook.`;
      }
      return NOTEBOOK_PROPOSAL_MESSAGE;
    },
  });
}
