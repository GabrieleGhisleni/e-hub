/*
 * Local-only editor for the exploration's notebook (the dev server). Loaded lazily through `../dev-slots.tsx`, so the
 * static build shows only the read view of the page.
 */
import { PencilIcon, Trash2Icon } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { Label } from "@ehub/ui/components/label";
import { Textarea } from "@ehub/ui/components/textarea";
import { MAX_NOTEBOOK_LENGTH, type Exploration } from "../../schema.ts";
import { NotebookView } from "../notebook-view.tsx";
import type { ExploreStore } from "../store.ts";

const HINT = "Scrivilo qui o aggiungi risposte dalla chat.";

/** The notebook with local controls: view, edit (Markdown textarea), clear. Writes go through the store. */
export function NotebookDevEditor({
  exploration,
  store,
}: {
  exploration: Exploration;
  store: ExploreStore;
}) {
  const { notebook } = exploration;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // The notebook's `updatedAt` when the edit started ("" when there was none): a change means someone else wrote.
  const [startedAt, setStartedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const current = notebook?.updatedAt ?? "";
  const changedWhileEditing = editing && current !== startedAt;
  const length = draft.trim().length;
  const tooLong = length > MAX_NOTEBOOK_LENGTH;

  const startEdit = () => {
    setDraft(notebook?.body ?? "");
    setStartedAt(current);
    setEditing(true);
  };

  /** Writes the notebook through the store; an empty body clears it. Returns whether it was saved. */
  const write = async (body: string, success: string): Promise<boolean> => {
    setBusy(true);
    try {
      await store.setNotebook(exploration.id, body);
      toast.success(success);
      return true;
    } catch (error) {
      toast.error((error as Error).message || "Operazione non riuscita.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (tooLong) return;
    const saved = await write(
      draft,
      draft.trim() === "" ? "Quaderno svuotato" : "Quaderno salvato",
    );
    if (saved) setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  };

  if (editing) {
    return (
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4">
        <Label htmlFor={`${id}-body`}>Quaderno (Markdown)</Label>
        <Textarea
          id={`${id}-body`}
          className="min-h-64 font-mono"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            className={tooLong ? "text-destructive" : "text-muted-foreground"}
            aria-live="polite"
          >
            {length} / {MAX_NOTEBOOK_LENGTH}
            {tooLong ? " · troppo lungo per essere salvato" : ""}
          </span>
          <span className="text-muted-foreground">Ctrl/⌘+Invio per salvare, Esc per annullare</span>
        </div>
        {changedWhileEditing ? (
          <p role="status" className="text-xs text-muted-foreground">
            Il quaderno è cambiato mentre lo modificavi (es. dalla chat): salvando sostituisci quella versione.
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Annulla
          </Button>
          <Button disabled={busy || tooLong} onClick={() => void save()}>
            Salva
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <NotebookView notebook={notebook} emptyHint={HINT} />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={busy} onClick={startEdit}>
          <PencilIcon aria-hidden /> Modifica
        </Button>
        {notebook ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2Icon aria-hidden /> Svuota
          </Button>
        ) : null}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Svuotare il quaderno?</DialogTitle>
            <DialogDescription>
              Tutto il testo del quaderno viene cancellato. Non si può annullare.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                const cleared = await write("", "Quaderno svuotato");
                if (cleared) setConfirmClear(false);
              }}
            >
              Svuota quaderno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
