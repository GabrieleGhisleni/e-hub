/**
 * Readable Italian labels for the tool calls shown as chips under an assistant reply.
 * Unknown tools fall back to their raw name, so a new tool never breaks the chat.
 * A `book` input (the multi-book tools of an exploration) is named after the label, with its ID.
 */

import { SAVE_NOTE_TOOL } from "../shared/save-note";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The book ID of the input, when the tool names one. */
function bookOf(args: Record<string, unknown>): string | undefined {
  return typeof args.book === "string" && args.book.trim() !== "" ? args.book.trim() : undefined;
}

export function describeToolCall(name: string, input: unknown): string {
  const args = isRecord(input) ? input : {};
  const book = bookOf(args);
  const named = (label: string) => (book !== undefined ? `${label} (libro ${book})` : label);

  switch (name) {
    case "read_chapter": {
      const chapter = positiveInteger(args.chapter);
      const part = positiveInteger(args.part);
      const base = chapter !== undefined ? `Legge il capitolo ${chapter}` : "Legge un capitolo";
      return named(part !== undefined && part > 1 ? `${base} (parte ${part})` : base);
    }
    case "search_book": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (query !== "") {
        return book !== undefined ? `Cerca «${query}» (libro ${book})` : `Cerca «${query}»`;
      }
      return named("Cerca nel libro");
    }
    case "list_chapters":
      return named("Guarda l'indice");
    case "propose_verdicts":
      return "Propone i verdetti";
    case SAVE_NOTE_TOOL:
      return "Salva una nota";
    default:
      return `Strumento: ${name}`;
  }
}
