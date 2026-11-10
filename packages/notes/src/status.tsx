import { RotateCcwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { type NotesStore, notesStore, useNotesMeta } from "./store";

/** The last load/save failure, with "Riprova" (reload from the server) and dismiss. */
export function NotesErrorBanner({
  store = notesStore,
  className,
}: {
  store?: NotesStore;
  className?: string;
}) {
  const { error } = useNotesMeta(store);
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm",
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 break-words">{error}</p>
      <div className="-my-1 flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => store.reload()}>
          <RotateCcwIcon aria-hidden /> Riprova
        </Button>
        <button
          type="button"
          onClick={() => store.dismissError()}
          aria-label="Chiudi l'avviso"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
