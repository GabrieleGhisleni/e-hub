import { InfoIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import type { SiteIndex, BookDetail } from "@shared/schema";
import { Button } from "@ehub/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@ehub/ui/components/sheet";
import { adminApi } from "./api";
import { BookFormFields } from "./book-form-fields";
import {
  bookChangedSince,
  bookToFormState,
  diffToPatch,
  isEmptyPatch,
  patchMovesFiles,
  validateForm,
  type BookFormState,
} from "./lib/book-form";
import { friendlyMessage } from "./lib/errors";
import { announceError, announceWrite } from "./notify";
import { useAdminIndexData } from "./use-admin-data";

function EditForm({
  book,
  index,
  onDone,
}: {
  book: BookDetail;
  index: SiteIndex | undefined;
  onDone: () => void;
}) {
  // Frozen at open time: a refresh of `book` must not turn untouched fields into "edits" (R1-09).
  const [initial] = useState(() => bookToFormState(book));
  const [state, setState] = useState<BookFormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const data = useAdminIndexData();
  const topics = index?.topics ?? data.topics;

  const errors = validateForm(state);
  const patch = diffToPatch(initial, state);
  const unchanged = isEmptyPatch(patch);
  const moves = patchMovesFiles(patch, initial.authors);
  const changedOnDisk = bookChangedSince(initial, book);

  async function save() {
    setShowErrors(true);
    if (Object.keys(errors).length > 0 || unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await adminApi.updateBook(book.id, patch);
      announceWrite("Modifiche salvate", response.report);
      onDone();
    } catch (e) {
      setError(friendlyMessage(e));
      announceError("Salvataggio non riuscito", e);
      setBusy(false);
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <BookFormFields
          idPrefix="edit"
          value={state}
          onChange={setState}
          topics={topics}
          allTags={data.allTags}
          errors={showErrors ? errors : {}}
          disabled={busy}
        />
        {changedOnDisk ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm"
          >
            <InfoIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <p>
              Il libro è cambiato su disco mentre il modulo era aperto. Verranno salvati solo i
              campi che hai modificato qui; chiudi e riapri il modulo per vedere i valori
              aggiornati.
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <SheetFooter className="border-t border-border">
        {moves ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm"
          >
            <InfoIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <p>
              Cambiando titolo o primo autore il file di questo libro sul Kobo verrà{" "}
              <strong>rinominato</strong>. I progressi di lettura restano.
            </p>
          </div>
        ) : null}
        <Button type="submit" disabled={busy || unchanged}>
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" />
              {moves ? "Salvataggio e aggiornamento del Kobo…" : "Salvataggio…"}
            </>
          ) : (
            "Salva modifiche"
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Annulla
        </Button>
      </SheetFooter>
    </form>
  );
}

export function EditBookSheet({
  book,
  index,
  open,
  onOpenChange,
}: {
  book: BookDetail;
  index: SiteIndex | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Modifica libro</SheetTitle>
          <SheetDescription>
            Si salvano solo i campi cambiati. Un campo opzionale svuotato viene rimosso.
          </SheetDescription>
        </SheetHeader>
        {open ? <EditForm book={book} index={index} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
