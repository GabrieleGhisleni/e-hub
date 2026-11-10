import { Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type { BookCard } from "@shared/schema";
import { statusLabel } from "@shared/labels";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ehub/ui/components/select";
import { BOOK_STATUSES, type BookStatus } from "@shared/schema";
import { adminApi } from "./api";
import { Field, TagsField } from "./book-form-fields";
import { EMPTY_BULK, buildBulkPatch, describeBulkPatch, type BulkFormState } from "./lib/bulk";
import { friendlyMessage } from "./lib/errors";
import { collectTags, type TagUsage } from "./lib/tags";
import { announceError, announceWrite } from "./notify";

const KEEP = "__keep__";

export function BulkEditDialog({
  open,
  onOpenChange,
  books,
  topics,
  allTags,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected books. */
  books: readonly BookCard[];
  topics: readonly { id: string; label: string }[];
  allTags: readonly TagUsage[];
  onApplied: () => void;
}) {
  const [state, setState] = useState<BulkFormState>(EMPTY_BULK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTags = useMemo(() => collectTags(books), [books]);
  const patch = buildBulkPatch(state);
  const lines = patch
    ? describeBulkPatch(patch, {
        topic: (id) => topics.find((t) => t.id === id)?.label ?? id,
        status: statusLabel,
      })
    : [];
  const count = books.length;

  async function apply() {
    if (!patch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await adminApi.bulkUpdate({ ids: books.map((b) => b.id), patch });
      announceWrite(
        `${response.books.length === 1 ? "1 libro aggiornato" : `${response.books.length} libri aggiornati`}`,
        response.report,
      );
      setState(EMPTY_BULK);
      onApplied();
    } catch (e) {
      setError(friendlyMessage(e));
      announceError("Modifica in blocco non riuscita", e);
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setState(EMPTY_BULK);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Modifica in blocco · {count === 1 ? "1 libro" : `${count} libri`}
          </DialogTitle>
          <DialogDescription>
            Imposta solo ciò che vuoi cambiare: il resto resta com&rsquo;è. I tag si confrontano
            senza distinguere maiuscole e accenti.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Argomento" htmlFor="bulk-topic">
            <Select
              value={state.topic === "" ? KEEP : state.topic}
              onValueChange={(v) => setState({ ...state, topic: v === KEEP ? "" : v })}
              disabled={busy}
            >
              <SelectTrigger id="bulk-topic" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Non cambiare</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Stato"
            htmlFor="bulk-status"
            hint={state.topic !== "" ? "Cambiare argomento sposta i file su Drive." : undefined}
          >
            <Select
              value={state.status === "" ? KEEP : state.status}
              onValueChange={(v) =>
                setState({ ...state, status: v === KEEP ? "" : (v as BookStatus) })
              }
              disabled={busy}
            >
              <SelectTrigger id="bulk-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Non cambiare</SelectItem>
                {BOOK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Aggiungi tag" htmlFor="bulk-add-tags">
            <TagsField
              id="bulk-add-tags"
              label="Tag da aggiungere"
              value={state.addTags}
              onChange={(v) => setState({ ...state, addTags: v })}
              allTags={allTags}
              disabled={busy}
              placeholder="Tag da aggiungere"
            />
          </Field>
          <Field
            label="Rimuovi tag"
            htmlFor="bulk-remove-tags"
            hint="I suggerimenti sono i tag dei libri selezionati."
          >
            <TagsField
              id="bulk-remove-tags"
              label="Tag da rimuovere"
              value={state.removeTags}
              onChange={(v) => setState({ ...state, removeTags: v })}
              allTags={selectedTags}
              disabled={busy}
              placeholder="Tag da rimuovere"
            />
          </Field>
        </div>

        {lines.length > 0 ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
            Verrà applicato a {count === 1 ? "1 libro" : `${count} libri`}: {lines.join(" · ")}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Annulla
          </Button>
          <Button onClick={() => void apply()} disabled={busy || !patch}>
            {busy ? (
              <>
                <Loader2Icon className="animate-spin" />
                Applicazione…
              </>
            ) : (
              "Applica"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
