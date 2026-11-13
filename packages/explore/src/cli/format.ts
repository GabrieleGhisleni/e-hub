/** Plain-text rendering for the CLI (Italian). JSON output is the exploration itself, not this. */
import { type Exploration, formatVerdict } from "../schema.ts";
import type { PreparedExploration } from "../node/index.ts";

const STATUS_LABELS = { open: "aperta", closed: "chiusa" } as const;
const ORIGIN_LABELS = { library: "libreria", explore: "solo esplorazione" } as const;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

/** Left-aligned text table; cells are not clipped (titles are short enough). */
export function formatTable(header: string[], rows: string[][]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => [...(r[i] ?? "")].length)));
  const render = (r: string[]) =>
    r
      .map((cell, i) => cell + " ".repeat(Math.max(0, widths[i]! - [...cell].length)))
      .join("  ")
      .trimEnd();
  return [render(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(render)];
}

/** The readable view of one exploration (`explore show`). */
export function formatExploration(e: Exploration): string[] {
  const lines: string[] = [];
  lines.push(`«${e.title}»  [${e.id}]`);
  lines.push(`Domanda: ${e.question}`);
  lines.push(`Stato: ${STATUS_LABELS[e.status]}  ·  aggiornata ${formatDate(e.updatedAt)}`);
  lines.push("");
  lines.push(`Fonti (${e.sources.length})`);
  if (e.sources.length === 0) lines.push("  nessuna fonte: aggiungine con «explore add»");
  e.sources.forEach((source, i) => {
    const lang = source.language ? `, ${source.language}` : "";
    const authors = source.authors.length > 0 ? ` — ${source.authors.join(", ")}` : "";
    lines.push(
      `  ${i + 1}. ${source.title}${authors}`,
      `     ${source.id} · ${ORIGIN_LABELS[source.origin]}${lang} · ${formatVerdict(source.verdict)}`,
    );
    if (source.verdict) lines.push(`     Motivazione: ${source.verdict.reason}`);
  });
  lines.push("");
  lines.push("Sintesi");
  lines.push(e.summary ? indent(e.summary) : "  nessuna sintesi");
  lines.push("");
  lines.push("Quaderno");
  lines.push(e.notebook ? indent(e.notebook.body) : "  Vuoto");
  lines.push("");
  lines.push(`Note (${e.notes.length})`);
  if (e.notes.length === 0) lines.push("  nessuna nota");
  for (const note of e.notes) {
    const about = note.book ? ` (su ${note.book})` : "";
    lines.push(`  - ${formatDate(note.createdAt)}${about}`, indent(note.body, "    "));
  }
  lines.push("");
  lines.push(`Diario (${e.journal.length})`);
  if (e.journal.length === 0) lines.push("  nessuna voce");
  for (const entry of e.journal) {
    lines.push(`  - ${formatDate(entry.at)} (${entry.via})`, indent(entry.text, "    "));
  }
  return lines;
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** `explore prepare`: sizes per book, the total and the strategy the chat will use. */
export function formatPrepared(p: PreparedExploration): string[] {
  const n = (value: number) => value.toLocaleString("it-IT");
  const lines = [`Preparazione di ${p.id}`];
  for (const book of p.books) {
    const origin = book.origin === "library" ? "libreria" : "esplorato";
    const summary = book.summary === null ? "" : `, riassunto ${book.summary ? "sì" : "no"}`;
    lines.push(
      `  [${origin}] ${book.id}  ${book.title}`,
      `      ${book.chapters} capitoli, ${n(book.words)} parole, ~${n(book.tokens)} token${summary}`,
      `      testo: ${book.textDir}`,
    );
  }
  if (p.books.length === 0) lines.push("  nessuna fonte");
  lines.push(
    `Totale: ~${n(p.totalTokens)} token su ${n(p.budget)} di budget.`,
    `Strategia: ${p.strategy === "intero" ? "intero (i libri entrano nel budget)" : "per capitoli (il totale supera il budget)"}.`,
  );
  return lines;
}
