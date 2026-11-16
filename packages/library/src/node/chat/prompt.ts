/**
 * System prompt of the chat about one book (docs/chat.md §3, source `book`). Italian; the model answers in the
 * language of the user. The summaries are a map: the rules tell the model to read the chapters before claiming details.
 */
import type { BookSummary, Book, Highlight } from "../../shared/schema.ts";
import { PROPOSE_BOOK_NOTES_TOOL } from "../../shared/chat-edit.ts";
import { isFrontOrBackMatter } from "../summary/index.ts";
import type { TextManifestChapter } from "../text/index.ts";

export type BookPromptInput = {
  book: Book;
  /** `summary.json`, or null when the book has none. */
  summary: BookSummary | null;
  /** Chapters from the cached text manifest, used only when there is no summary (undefined: not cached). */
  chapters?: TextManifestChapter[];
  /** `notes.md`: the general notes of the book ("Appunti"), Markdown. */
  notes?: string | null;
  /** `highlights.json`: the passages underlined on the Kobo, in reading order. */
  highlights?: readonly Highlight[];
  /** The notes thread at the bottom of the book page. */
  threadNotes?: readonly ThreadNote[];
};

/** A note the user wrote in the notes thread of the book page (`packages/notes`). */
export type ThreadNote = { body: string; pinned?: boolean; createdAt?: string };

export function renderBookPrompt({
  book,
  summary,
  chapters,
  notes = null,
  highlights = [],
  threadNotes = [],
}: BookPromptInput): string {
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
    "- Hai davanti la pagina del libro dell'utente: Appunti, sottolineature (con le sue note) e note del thread. Leggile quando servono (ad esempio per «cosa ho sottolineato?»), senza ripeterle se non richiesto.",
    `- Se l'utente chiede di scrivere o cambiare gli Appunti del libro, chiama ${PROPOSE_BOOK_NOTES_TOOL} con il testo COMPLETO in Markdown (senza titolo di primo livello: la pagina ha già l'intestazione «Appunti»): sostituisce quello attuale, quindi riporta anche le parti da mantenere. L'utente rivede e conferma: non dire mai che è stato salvato. Le sottolineature e le note del thread non si modificano da qui.`,
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

  lines.push(
    "",
    "## Appunti del libro (blocco «Appunti» della pagina, Markdown)",
    notes?.trim() || "(vuoto)",
  );

  if (highlights.length > 0) {
    lines.push("", `## Sottolineature dell'utente (${highlights.length}, nell'ordine del libro)`);
    let chapter: string | undefined | null = null;
    for (const h of highlights) {
      if (h.chapter !== chapter) {
        chapter = h.chapter;
        lines.push(`### ${chapter ?? "Senza capitolo"}`);
      }
      lines.push(`- «${h.text}»${h.page ? ` (p. ${h.page})` : ""}`);
      if (h.note) lines.push(`  Nota dell'utente: ${h.note}`);
    }
  }

  if (threadNotes.length > 0) {
    lines.push(
      "",
      "## Note dell'utente (thread in fondo alla pagina, dalla più vecchia)",
      ...threadNotes.map(
        (note, index) =>
          `### Nota ${index + 1}${note.pinned ? " (fissata)" : ""}${note.createdAt ? `, ${note.createdAt.slice(0, 10)}` : ""}\n${note.body.trim()}`,
      ),
    );
  }

  return lines.join("\n");
}

function chapterNote(title: string, summary: string | null): string {
  if (summary) return summary;
  return isFrontOrBackMatter(title) ? "(parte accessoria)" : "(nessuna sintesi)";
}
