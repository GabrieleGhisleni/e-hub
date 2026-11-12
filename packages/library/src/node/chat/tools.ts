/**
 * Tools of the book chat: list_chapters, read_chapter, search_book. Their names and input shapes are a contract with
 * the chat panel: keep them. Every tool returns a string; failures to load the text become "Testo del libro non
 * disponibile: ..." so the model can tell the user.
 */
import { defineTool, type ToolSet } from "@ehub/chat/node";
import { z } from "zod";
import type { BookSummary } from "../../shared/schema.ts";
import { splitIntoParts } from "../summary/index.ts";
import type { TextManifestChapter } from "../text/index.ts";
import { searchBook } from "./search.ts";
import type { BookText } from "./text.ts";

/** Words per part returned by read_chapter. */
export const PART_WORDS = 6000;
/** Hits shown by search_book. */
export const MAX_HITS = 20;
/** Longest query accepted by search_book, in characters. */
export const MAX_QUERY_CHARS = 200;

export type BookToolsOptions = {
  /** The book's language tag, if known (named in the "no hits" answer). */
  language?: string;
  /** `summary.json` when it exists: list_chapters uses it, so it does not need the text. */
  summary: BookSummary | null;
  /** Loads the text; called at most once per book by the caller (memoized there). */
  loadText: () => Promise<BookText>;
};

export function bookTools({ language, summary, loadText }: BookToolsOptions): ToolSet {
  return {
    list_chapters: defineTool({
      description: "Elenca i capitoli del libro: numero, titolo, parole e se hanno una sintesi.",
      inputSchema: z.object({}),
      execute: () =>
        guarded(async () => {
          const chapters: { n: number; title: string; words: number; hasSummary: boolean }[] =
            summary
              ? summary.chapters.map((c) => ({
                  n: c.n,
                  title: c.title,
                  words: c.words,
                  hasSummary: c.summary !== null,
                }))
              : (await loadText()).manifest.chapters.map((c) => ({
                  n: c.n,
                  title: c.title,
                  words: c.words,
                  hasSummary: false,
                }));
          if (chapters.length === 0) return "Il libro non ha capitoli.";
          const status = (hasSummary: boolean) =>
            hasSummary ? "con sintesi" : summary ? "senza sintesi" : "sintesi non disponibile";
          return chapters
            .map((c) => `${c.n}. ${c.title} (${c.words} parole) — ${status(c.hasSummary)}`)
            .join("\n");
        }),
    }),

    read_chapter: defineTool({
      description:
        "Legge il testo di un capitolo, in parti di circa 6000 parole. Il numero di parte è facoltativo (default 1); se il capitolo continua, la risposta lo dice.",
      inputSchema: z.object({
        chapter: z.number().int().min(1).describe("Numero del capitolo (da list_chapters)"),
        part: z.number().int().min(1).optional().describe("Parte da leggere, a partire da 1"),
      }),
      execute: ({ chapter, part }) =>
        guarded(async () => {
          const text = await loadText();
          const entries = text.manifest.chapters;
          const entry = entries.find((c) => c.n === chapter);
          if (!entry) return unknownChapter(chapter, entries);

          const parts = splitIntoParts(await text.readChapter(chapter), PART_WORDS);
          const total = Math.max(1, parts.length);
          const wanted = part ?? 1;
          if (wanted > total)
            return `Il capitolo ${chapter} ha ${total} parti: part va da 1 a ${total}.`;

          const lines = [
            `Capitolo ${chapter} «${entry.title}» — parte ${wanted} di ${total}`,
            "",
            parts[wanted - 1] ?? "(capitolo vuoto)",
          ];
          if (wanted < total) {
            lines.push(
              "",
              `[Il capitolo continua. Per leggere il seguito chiama read_chapter con chapter=${chapter} e part=${wanted + 1}.]`,
            );
          }
          return lines.join("\n");
        }),
    }),

    search_book: defineTool({
      description:
        "Cerca nel testo di tutti i capitoli (senza distinguere maiuscole e accenti). Restituisce fino a 20 passaggi con il capitolo.",
      inputSchema: z.object({
        query: z.string().min(1).max(MAX_QUERY_CHARS).describe("Parole o frase da cercare"),
      }),
      execute: ({ query }) =>
        guarded(async () => {
          const result = await searchBook(await loadText(), query);
          if (result.total === 0) {
            const lang = language ? ` (lingua del libro: ${language})` : "";
            return `Nessun risultato per «${query}» nel libro. Prova sinonimi o la traduzione del termine: il libro può essere in un'altra lingua${lang}.`;
          }
          const shown = result.hits.slice(0, MAX_HITS);
          const heading =
            result.mode === "all-words"
              ? `Nessuna frase esatta. Ci sono ${result.total} righe che contengono tutte le parole di «${query}»`
              : `Trovati ${result.total} passaggi per «${query}»`;
          const more = result.total > shown.length ? ` (mostro i primi ${shown.length})` : "";
          return [
            `${heading}${more}:`,
            ...shown.map((hit) => `- cap. ${hit.chapter} «${hit.title}»: ${hit.snippet}`),
          ].join("\n");
        }),
    }),
  };
}

function unknownChapter(chapter: number, entries: TextManifestChapter[]): string {
  if (entries.length === 0) return "Il libro non ha capitoli.";
  const first = entries[0]!.n;
  const last = entries[entries.length - 1]!.n;
  return `Il capitolo ${chapter} non esiste. I capitoli vanno da ${first} a ${last} (${entries.length} in tutto).`;
}

/** Runs a tool body; a failure to load or read the text becomes the Italian message the model can relay. */
async function guarded(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (error) {
    return `Testo del libro non disponibile: ${error instanceof Error ? error.message : String(error)}`;
  }
}
