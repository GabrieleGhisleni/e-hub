/**
 * System prompt of the chat about an exploration (Italian; the model answers in the language of the user). Pure
 * rendering: the caller loads the summaries, the manifests and the notes' books, so this file has no I/O.
 */
import { formatVerdict, type BookSource, type Exploration } from "../schema.ts";
import type { BookSummary, TextManifest } from "@ehub/library/explore";

type TextManifestChapter = TextManifest["chapters"][number];

/** A source with what the prompt shows about its text. */
export type PromptBook = {
  source: BookSource;
  /** `summary.json` (library books only), or null. */
  summary: BookSummary | null;
  /** Chapters from the cached manifest; undefined when the text is not cached. Used only without a summary. */
  chapters?: TextManifestChapter[];
};

const CHAPTERS_UNAVAILABLE = "(capitoli non ancora disponibili: usa list_chapters)";

export function renderExplorationPrompt(exploration: Exploration, books: PromptBook[]): string {
  const bookById = new Map(books.map((book) => [book.source.id, book.source]));
  const lines: string[] = [
    "Sei un assistente che aiuta l'utente a esplorare una domanda attraverso più libri. Il lavoro si svolge in due tempi: prima il triage (decidere quali libri e quali capitoli valgono la lettura per la domanda), poi la risposta, basata sul testo. Rispondi nella lingua in cui l'utente scrive.",
    "",
    "Regole:",
    "- Il triage viene prima della lettura: usa le sintesi e l'elenco dei capitoli per scegliere cosa leggere, senza affermare nulla che non hai letto.",
    "- Le sintesi qui sotto sono solo una mappa dei libri, non il loro testo. Prima di fare affermazioni specifiche o spiegare dettagli, LEGGI i capitoli pertinenti con gli strumenti (list_chapters, read_chapter, search_book).",
    "- Leggi pochi capitoli pertinenti piuttosto che molti.",
    "- Cita così: («Titolo breve», cap. N), usando un titolo breve del libro.",
    "- Cita il testo solo con passaggi brevi (al massimo due frasi) tra virgolette. Non riportare passaggi lunghi.",
    "- Se un libro non tratta una cosa, dillo chiaramente invece di inventare.",
    "- Non attribuire agli autori affermazioni che non hai verificato nel testo.",
    "- Gli strumenti vogliono l'ID del libro, come indicato nella sezione «Fonti».",
    "- Quando l'utente chiede di chiudere l'esplorazione o di decidere i verdetti, chiama propose_verdicts con un verdetto per libro (e, se serve, una sintesi e una voce di diario). La proposta NON viene salvata: l'utente la rivede e la conferma nell'interfaccia.",
    "- Il Quaderno è il documento di appunti condiviso di tutta l'esplorazione, costruito con l'utente chattando su tutti i libri.",
    "- Quando l'utente chiede di aggiungere o salvare qualcosa nel Quaderno («aggiungilo al quaderno», «segnatelo», «salvalo»), chiama save_note con un testo autosufficiente in Markdown (prima riga in grassetto con l'argomento, citazioni «Titolo breve», cap. N): viene aggiunto in fondo al Quaderno.",
    "- Quando l'utente chiede di riorganizzare, riscrivere, condensare, correggere o ristrutturare il Quaderno, chiama propose_notebook con il testo COMPLETO del nuovo Quaderno: non salva nulla, l'utente lo rivede e lo conferma.",
    "- Non togliere mai contenuto dal Quaderno in una riscrittura, a meno che l'utente non lo chieda.",
  ];

  lines.push(
    "",
    "## Esplorazione",
    `- Titolo: ${exploration.title}`,
    `- Domanda: ${exploration.question}`,
    `- Stato: ${exploration.status === "open" ? "aperta" : "chiusa"}`,
  );

  lines.push("", "## Fonti");
  if (books.length === 0) lines.push("Non ci sono ancora libri in questa esplorazione.");
  for (const { source, summary, chapters } of books) {
    lines.push("", `### «${source.title}» (ID ${source.id})`);
    lines.push(`- Autori: ${source.authors.length > 0 ? source.authors.join(", ") : "non indicati"}`);
    if (source.language) lines.push(`- Lingua: ${source.language}`);
    lines.push(`- Origine: ${source.origin === "library" ? "in libreria" : "solo da esplorare"}`);
    lines.push(`- Verdetto attuale: ${verdictLine(source)}`);
    lines.push(...bookLines(summary, chapters));
  }

  lines.push("", "## Sintesi dell'esplorazione");
  lines.push(exploration.summary ?? "Non ancora scritta.");

  lines.push("", "## Quaderno");
  lines.push(exploration.notebook?.body ?? "Vuoto.");

  lines.push("", "## Note");
  if (exploration.notes.length === 0) lines.push("Nessuna nota.");
  for (const note of exploration.notes) {
    const about = note.book ? bookLabel(bookById.get(note.book), note.book) : "generale";
    lines.push(`- [${about}] ${note.body}`);
  }

  lines.push("", "## Diario delle sessioni precedenti");
  lines.push(
    "Le voci registrano le sessioni già svolte (anche con la skill di Claude Code): continua da qui senza ripetere ciò che è già stato deciso o letto.",
  );
  if (exploration.journal.length === 0) lines.push("Nessuna voce.");
  for (const entry of exploration.journal) {
    lines.push(`- ${formatAt(entry.at)} (${entry.via}): ${entry.text}`);
  }

  return lines.join("\n");
}

/** The current verdict with its reason, or "nessun verdetto". */
function verdictLine(source: BookSource): string {
  if (!source.verdict) return "nessun verdetto";
  return `${formatVerdict(source.verdict)} — ${source.verdict.reason}`;
}

/** The summary of the book and of its chapters when there is one; else the chapter list; else a hint for the tools. */
function bookLines(summary: BookSummary | null, chapters: TextManifestChapter[] | undefined): string[] {
  if (summary) {
    const lines = ["", "Sintesi del libro:", summary.book, "", "Capitoli:"];
    for (const chapter of summary.chapters) {
      lines.push(`${chapter.n}. ${chapter.title} (${chapter.words} parole)`);
      lines.push(`   ${chapter.summary ?? "(nessuna sintesi)"}`);
    }
    return lines;
  }
  if (chapters) {
    return [
      "- Capitoli (senza sintesi):",
      ...chapters.map((chapter) => `  ${chapter.n}. ${chapter.title} (${chapter.words} parole)`),
    ];
  }
  return [`- ${CHAPTERS_UNAVAILABLE}`];
}

function bookLabel(source: BookSource | undefined, id: string): string {
  return source ? `«${source.title}» (${id})` : `libro ${id}`;
}

/** ISO instant as `YYYY-MM-DD HH:MM` (UTC), for the journal. */
function formatAt(at: string): string {
  return at.slice(0, 16).replace("T", " ");
}
