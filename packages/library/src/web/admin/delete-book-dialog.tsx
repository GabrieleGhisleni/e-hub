import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { BookDetail } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ehub/ui/components/alert-dialog";
import { Button } from "@ehub/ui/components/button";
import { adminApi } from "./api";
import { announceError, announceWrite } from "./notify";
import { libraryPath } from "@library/lib/paths";

export function DeleteBookDialog({
  book,
  open,
  onOpenChange,
}: {
  book: BookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await adminApi.deleteBook(book.id);
      announceWrite(`Eliminato «${book.title}»`, response.report);
      onOpenChange(false);
      void navigate(libraryPath(), { replace: true });
    } catch (e) {
      announceError("Eliminazione non riuscita", e);
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminare «{book.title}»?</AlertDialogTitle>
          <AlertDialogDescription>
            I file su Drive vanno nel cestino, dove restano recuperabili per 30 giorni. Il libro, la
            copertina e gli eventuali appunti vengono tolti dal repository (restano nella cronologia
            di git se li hai già pubblicati).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annulla</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy ? (
              <>
                <Loader2Icon className="animate-spin" />
                Eliminazione…
              </>
            ) : (
              "Elimina"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
