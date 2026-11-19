import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import type { Episode } from "@core/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ehub/ui/components/alert-dialog";
import { Button } from "@ehub/ui/components/button";
import { homePath } from "@podcasts/lib/paths";
import { api, describeError } from "./api";
import { flashAfterWrite } from "./storage";

/** Button "Rimuovi" with a confirmation: deletes the episode and its local files, then goes home. */
export function DeleteEpisode({ episode }: { episode: Episode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.remove(episode.slug);
      flashAfterWrite("success", "Episodio rimosso", episode.title);
      setOpen(false);
      // Vite reloads when the data file disappears; the flash is shown after the reload.
      void navigate(homePath());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Rimuovi episodio"
          title="Rimuovi episodio"
        >
          <Trash2 aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rimuovere l'episodio?</AlertDialogTitle>
          <AlertDialogDescription>
            «{episode.title}» sparisce dal catalogo, insieme alle conversazioni e alla trascrizione
            locale. Le note scritte sull'episodio restano nella pagina Note. L'operazione si annulla
            solo con git (e la trascrizione, che è fuori da git, va riscaricata).
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm whitespace-pre-line text-destructive">
              {error}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annulla</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />} Rimuovi
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
