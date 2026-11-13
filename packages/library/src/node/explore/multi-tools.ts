/**
 * Tools of an exploration's chat over several books: list_chapters, read_chapter and search_book, each taking the
 * book ID. They answer with the same formatting as the single-book tools (`src/node/chat/tools.ts`); the text of
 * each book is loaded at most once, and a failed load is retried on the next call.
 */
import { defineTool, type ToolSet } from "@ehub/chat/node";
import { z } from "zod";
import {
  MAX_QUERY_CHARS,
  errorMessage,
  formatChapterList,
  formatChapterPart,
  formatSearchReply,
  guarded,
  unavailableText,
  unknownChapter,
  type ChapterListItem,
} from "../chat/tools.ts";
import { searchBook, type SearchHit } from "../chat/search.ts";
import type { BookText } from "../chat/text.ts";
import type { BookSummary } from "../../shared/schema.ts";

/** A book of the exploration as the tools see it. */
export type MultiBook = {
  id: string;
  title: string;
  language?: string;
  /** `summary.json` when it exists: list_chapters uses it, so it does not need the text. */
  summary: BookSummary | null;
  /** Loads the text; called at most once per book (memoized by `multiBookTools`). */
  loadText: () => Promise<BookText>;
};

/** A search hit with the book it comes from. */
type BookHit = SearchHit & { book: MultiBook };

export function multiBookTools(books: MultiBook[]): ToolSet {
  const byId = new Map(books.map((book) => [book.id, book]));
  const texts = new Map<string, Promise<BookText>>();
  /** Memoized per book; a failed load is not kept, so the next call tries again. */
  const textOf = (book: MultiBook): Promise<BookText> => {
    let text = texts.get(book.id);
    if (text === undefined) {
      text = book.loadText();
      texts.set(book.id, text);
      text.catch(() => texts.delete(book.id));
    }
    return text;
  };

  return {
    list_chapters: defineTool({
      description:
        "Elenca i capitoli di un libro dell'esplorazione: numero, titolo, parole e se hanno una sintesi. Il libro è indicato con il suo ID.",
      inputSchema: z.object({
        book: z.string().describe("ID del libro, come nell'elenco dei libri della conversazione"),
      }),
      execute: ({ book }) => {
        const found = byId.get(book);
        if (!found) return unknownBook(book, books);
        return guarded(async () => {
          const chapters: ChapterListItem[] = found.summary
            ? found.summary.chapters.map((c) => ({
                n: c.n,
                title: c.title,
                words: c.words,
                hasSummary: c.summary !== null,
              }))
            : (await textOf(found)).manifest.chapters.map((c) => ({
                n: c.n,
                title: c.title,
                words: c.words,
                hasSummary: false,
              }));
          return formatChapterList(chapters, found.summary !== null);
        });
      },
    }),

    read_chapter: defineTool({
      description:
        "Legge il testo di un capitolo di un libro dell'esplorazione, in parti di circa 6000 parole. Il numero di parte è facoltativo (default 1); se il capitolo continua, la risposta lo dice.",
      inputSchema: z.object({
        book: z.string().describe("ID del libro"),
        chapter: z.number().int().min(1).describe("Numero del capitolo (da list_chapters)"),
        part: z.number().int().min(1).optional().describe("Parte da leggere, a partire da 1"),
      }),
      execute: ({ book, chapter, part }) => {
        const found = byId.get(book);
        if (!found) return unknownBook(book, books);
        return guarded(async () => {
          const text = await textOf(found);
          const entries = text.manifest.chapters;
          const entry = entries.find((c) => c.n === chapter);
          if (!entry) return unknownChapter(chapter, entries);
          return formatChapterPart({
            chapter,
            title: entry.title,
            body: await text.readChapter(chapter),
            part,
          });
        });
      },
    }),

    search_book: defineTool({
      description:
        "Cerca nel testo dei capitoli (senza distinguere maiuscole e accenti). Con book cerca nel solo libro indicato; senza book cerca in tutti i libri e ogni passaggio riporta il titolo e l'ID del libro. Restituisce fino a 20 passaggi.",
      inputSchema: z.object({
        query: z.string().min(1).max(MAX_QUERY_CHARS).describe("Parole o frase da cercare"),
        book: z
          .string()
          .optional()
          .describe("ID del libro in cui cercare; se assente, cerca in tutti"),
      }),
      execute: ({ query, book }) => {
        if (book === undefined) return searchAll(query);
        const found = byId.get(book);
        if (!found) return unknownBook(book, books);
        return guarded(async () =>
          formatSearchReply(await searchBook(await textOf(found), query), query, {
            language: found.language,
          }),
        );
      },
    }),
  };

  /**
   * Search across every book: the exact phrase when some book has it (as the single-book search does), otherwise the
   * lines with all the words. A book whose text fails to load is named at the end and the others are still searched.
   */
  async function searchAll(query: string): Promise<string> {
    const phrase: BookHit[] = [];
    const allWords: BookHit[] = [];
    const failures: { book: MultiBook; error: unknown }[] = [];
    for (const book of books) {
      try {
        const result = await searchBook(await textOf(book), query);
        const target = result.mode === "phrase" ? phrase : allWords;
        for (const hit of result.hits) target.push({ ...hit, book });
      } catch (error) {
        failures.push({ book, error });
      }
    }
    if (books.length > 0 && failures.length === books.length) {
      return unavailableText(failures[0]!.error);
    }

    const mode = phrase.length > 0 ? "phrase" : allWords.length > 0 ? "all-words" : "none";
    const hits = mode === "phrase" ? phrase : allWords;
    const label = (hit: BookHit) =>
      `«${hit.book.title}» (${hit.book.id}), cap. ${hit.chapter} «${hit.title}»`;
    let reply =
      hits.length === 0
        ? `Nessun risultato per «${query}» in nessuno dei libri. Prova sinonimi o la traduzione del termine: i libri possono essere in un'altra lingua.`
        : formatSearchReply({ mode, total: hits.length, hits }, query, { label });
    if (failures.length > 0) {
      reply += [
        "",
        "Testo non disponibile per:",
        ...failures.map(
          ({ book, error }) => `- «${book.title}» (${book.id}): ${errorMessage(error)}`,
        ),
      ].join("\n");
    }
    return reply;
  }
}

/** The answer for an ID that is not a book of the exploration: the valid IDs with their titles. */
function unknownBook(id: string, books: MultiBook[]): string {
  if (books.length === 0) return "Non ci sono libri in questa esplorazione.";
  const valid = books.map((book) => `${book.id} («${book.title}»)`).join(", ");
  return `Il libro ${id} non esiste. I libri disponibili sono: ${valid}.`;
}
