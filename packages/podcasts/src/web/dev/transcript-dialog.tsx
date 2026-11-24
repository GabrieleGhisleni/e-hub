import { useState } from "react";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ehub/ui/components/dialog";
import type { Episode } from "@core/schema";
import type { TranscriptChoice } from "@core/transcript-import";
import { extractYoutubeId } from "@core/urls";
import { api, describeError } from "./api";
import { flashAfterWrite } from "./storage";
import { TranscriptInput } from "./transcript-input";

export function TranscriptDialog({ episode }: { episode: Episode }) {
  const [choice, setChoice] = useState<TranscriptChoice>();
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoId = episode.youtubeId ?? extractYoutubeId(episode.url);

  async function save(transcript: TranscriptChoice) {
    setProgress("");
    setBusy(true);
    setError("");
    try {
      await api.updateTranscript(episode.slug, episode.updatedAt, transcript, setProgress);
      flashAfterWrite(
        "success",
        transcript.mode === "none"
          ? "Trascrizione rimossa."
          : "Trascrizione salvata nel tuo account.",
      );
      window.location.reload();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      onOpenChange={() => {
        setChoice(undefined);
        setError("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          Trascrizione
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trascrizione dell’episodio</DialogTitle>
          <DialogDescription>
            {episode.transcriptSource
              ? `Origine: ${episode.transcriptSource === "api" ? "Groq · API" : episode.transcriptSource === "askchannel" ? "AskChannel · importazione" : episode.transcriptSource}. Disponibile anche da altri dispositivi.`
              : "Aggiungi una trascrizione all’episodio."}
          </DialogDescription>
        </DialogHeader>
        <TranscriptInput videoId={videoId} onChange={setChoice} disabled={busy} />
        {busy && <p role="status">{progress || "Operazione in corso…"}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          {episode.transcriptSource && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Rimuovere la trascrizione salvata?"))
                  void save({ mode: "none" });
              }}
            >
              Rimuovi
            </Button>
          )}
          <Button
            disabled={busy || !choice}
            onClick={() => {
              if (
                choice &&
                (!episode.transcriptSource || window.confirm("Sostituire la trascrizione salvata?"))
              )
                void save(choice);
            }}
          >
            {episode.transcriptSource ? "Sostituisci" : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
