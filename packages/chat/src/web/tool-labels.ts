/**
 * Readable Italian labels for the tool calls shown as chips under an assistant reply.
 * Unknown tools fall back to their raw name, so a new tool never breaks the chat.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function describeToolCall(name: string, input: unknown): string {
  const args = isRecord(input) ? input : {};

  switch (name) {
    case "read_chapter": {
      const chapter = positiveInteger(args.chapter);
      const part = positiveInteger(args.part);
      const base = chapter !== undefined ? `Legge il capitolo ${chapter}` : "Legge un capitolo";
      return part !== undefined && part > 1 ? `${base} (parte ${part})` : base;
    }
    case "search_book": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      return query !== "" ? `Cerca «${query}»` : "Cerca nel libro";
    }
    case "list_chapters":
      return "Guarda l'indice";
    default:
      return `Strumento: ${name}`;
  }
}
