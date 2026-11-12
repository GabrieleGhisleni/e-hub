/**
 * System prompt of the chat about one book (docs/chat.md §3, source `book`). Italian; the model answers in the
 * language of the user. The summaries are a map: the rules tell the model to read the chapters before claiming details.
 */
import type { BookSummary, Book } from "../../shared/schema.ts";
import { isFrontOrBackMatter } from "../summary/index.ts";
import type { TextManifestChapter } from "../text/index.ts";

export type BookPromptInput = {
  book: Book;
  /** `summary.json`, or null when the book has none. */
  summary: BookSummary | null;
  /** Chapters from the cached text manifest, used only when there is no summary (undefined: not cached). */
  chapters?: TextManifestChapter[];
};

export function renderBookPrompt({ book, summary, chapters }: BookPromptInput): string {
  const lines: string[] = [
    "Sei un assistente che aiuta l'utente a esplorare il libro descritto qui sotto, prima di leggerlo o mentre lo legge. Rispondi nella lingua in cui l'utente scrive.",
    "",
    "Regole:",
    "- Le sintesi qui sotto sono solo una mappa del libro, non il suo testo. Prima di fare affermazioni specifiche, citare o spiegare dettagli, LEGGI i capitoli pertinenti con gli strumenti (list_chapters, read_chapter, search_book).",
    "- Leggi pochi capitoli pertinenti piuttosto che molti.",
    "- Cita i capitoli così: (cap. N).",
    "- Cita il testo solo con passaggi brevi (al massimo due frasi) tra virgolette. Non riportare passaggi lunghi.",
    "- Se una cosa non è nel libro, dillo chiaramente invece di inventare.",
    "- Non attribuire all'autore affermazioni che non hai verificato nel testo.",
  ];

  lines.push("", "## Libro", `- Titolo: ${book.title}`, `- Autori: ${book.authors.join(", ")}`);
  if (book.language) lines.push(`- Lingua: ${book.language}`);
  if (book.description) lines.push(`- Descrizione: ${book.description}`);

  if (summary) {
    lines.push("", "## Sintesi del libro", summary.book);
  } else {
    lines.push(
      "",
      "## Sintesi",
      "Le sintesi non sono disponibili per questo libro. Per rispondere, leggi i capitoli con read_chapter o cerca nel testo con search_book.",
    );
  }

  lines.push("", "## Capitoli");
  if (summary) {
    for (const chapter of summary.chapters) {
      lines.push(`${chapter.n}. ${chapter.title} (${chapter.words} parole)`);
      lines.push(`   ${chapterNote(chapter.title, chapter.summary)}`);
    }
  } else if (chapters) {
    for (const chapter of chapters) {
      lines.push(`${chapter.n}. ${chapter.title} (${chapter.words} parole)`);
    }
  } else {
    lines.push("(elenco non ancora disponibile: usa list_chapters)");
  }

  return lines.join("\n");
}

function chapterNote(title: string, summary: string | null): string {
  if (summary) return summary;
  return isFrontOrBackMatter(title) ? "(parte accessoria)" : "(nessuna sintesi)";
}
