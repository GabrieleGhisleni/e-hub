import { NoteMarkdown } from "@ehub/notes";
import type { Notebook } from "../schema.ts";
import { VIA_LABELS, formatDay } from "./format.ts";

/**
 * The notebook as the reader sees it: its Markdown, with who wrote it last and when. Shared by the public page
 * and the local editor, which adds its own controls around it.
 */
export function NotebookView({
  notebook,
  emptyHint,
}: {
  notebook: Notebook | undefined;
  /** Extra line for the empty state (local only). */
  emptyHint?: string;
}) {
  if (!notebook) {
    return (
      <p className="text-sm text-muted-foreground">
        Il quaderno è vuoto.
        {emptyHint ? <span className="block pt-1">{emptyHint}</span> : null}
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        <time dateTime={notebook.updatedAt}>Aggiornato il {formatDay(notebook.updatedAt)}</time> ·{" "}
        {VIA_LABELS[notebook.via]}
      </p>
      <NoteMarkdown text={notebook.body} className="mt-3" />
    </div>
  );
}
