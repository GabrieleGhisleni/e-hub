import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import type { Episode } from "@core/schema";
import { Alert, AlertDescription, AlertTitle } from "@ehub/ui/components/alert";
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
import { Input } from "@ehub/ui/components/input";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { api, describeError, type SpeakerInfo } from "./api";

/** Mapping old → new for the names that changed (empty when nothing did). */
export function changedMapping(
  speakers: readonly SpeakerInfo[],
  names: Readonly<Record<string, string>>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const { speaker } of speakers) {
    const name = (names[speaker] ?? speaker).trim();
    if (name !== speaker) mapping[speaker] = name;
  }
  return mapping;
}

/** Speaker correction on the local transcript: swap host/guest or name each speaker. */
export function SpeakersDialog({ episode }: { episode: Episode }) {
  const [open, setOpen] = useState(false);
  const [speakers, setSpeakers] = useState<SpeakerInfo[]>();
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = (list: SpeakerInfo[]) => {
    setSpeakers(list);
    setNames(Object.fromEntries(list.map((s) => [s.speaker, s.speaker])));
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    api.speakers(episode.slug).then(
      (result) => active && load(result.speakers),
      (e: unknown) => active && setError(describeError(e)),
    );
    return () => {
      active = false;
    };
  }, [open, episode.slug]);

  const mapping = speakers ? changedMapping(speakers, names) : {};
  const hasChanges = Object.keys(mapping).length > 0;

  const swap = () => {
    if (!speakers || speakers.length !== 2) return;
    const [a, b] = speakers as [SpeakerInfo, SpeakerInfo];
    setNames({ [a.speaker]: b.speaker, [b.speaker]: a.speaker });
  };

  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.renameSpeakers(episode.slug, mapping);
      load(result.speakers);
      toast.success("Speaker aggiornati", {
        description: "Modificata la trascrizione locale (non è un file tracciato).",
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Users aria-hidden /> Speaker
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correzione degli speaker</DialogTitle>
          <DialogDescription>
            Scambia host e ospite, oppure assegna un nome a ciascuno speaker. Cambia solo la
            trascrizione locale.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Non riuscito</AlertTitle>
            <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
          </Alert>
        )}
        {!speakers && !error && <Skeleton className="h-24 w-full" />}
        {speakers && speakers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Questa trascrizione non ha speaker (la fonte non li fornisce).
          </p>
        )}
        {speakers && speakers.length > 0 && (
          <div className="space-y-3">
            {speakers.length === 2 && (
              <Button variant="secondary" size="sm" onClick={swap}>
                <ArrowLeftRight aria-hidden /> Scambia i due speaker
              </Button>
            )}
            <ul className="space-y-2">
              {speakers.map((info) => (
                <li key={info.speaker} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Input
                    aria-label={`Nome per ${info.speaker}`}
                    value={names[info.speaker] ?? info.speaker}
                    onChange={(event) =>
                      setNames((n) => ({ ...n, [info.speaker]: event.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {info.segments} segmenti
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button disabled={!hasChanges || busy} onClick={() => void apply()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Applica
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
