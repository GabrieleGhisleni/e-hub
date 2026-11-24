import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { countTags } from "@core/tags";
import { GUEST_DESCRIPTION_MAX_LENGTH, type Episode } from "@core/schema";
import { Alert, AlertDescription, AlertTitle } from "@ehub/ui/components/alert";
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
import { useSiteData } from "@podcasts/site-data";
import { api, ApiError, describeError } from "./api";
import { GuestsInput, TagInput } from "./chip-input";
import {
  clearDraft,
  loadDraft,
  sameValues,
  saveDraft,
  startingState,
  summaryPoints,
  valuesOf,
  type EditorDraft,
  type EditorValues,
} from "./drafts";
import { flashAfterWrite } from "./storage";

/** True when a draft with unsaved changes exists for the episode (the editor reopens on reload). */
export function hasPendingDraft(episode: Episode): boolean {
  const draft = loadDraft(episode.slug);
  return draft !== undefined && !sameValues(startingState(episode, draft), valuesOf(episode));
}

/**
 * Editor for summary / notes / tags / guests and their descriptions in a dialog (DESIGN.md §8.5).
 * Every change is mirrored into a `sessionStorage` draft; it is cleared after
 * a successful save. A 409 (the file changed meanwhile) keeps the text and
 * offers to reload the fresh version.
 */
export function EpisodeEditorDialog({
  episode,
  open,
  onOpenChange,
}: {
  episode: Episode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { catalog } = useSiteData();
  const suggestions = useMemo(() => countTags(catalog.episodes), [catalog.episodes]);
  const [state, setState] = useState<EditorDraft>(() =>
    startingState(episode, loadDraft(episode.slug)),
  );
  // The episode changed under the open editor (HMR after a save from the CLI or a skill): re-merge.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(episode.updatedAt);
  if (seenUpdatedAt !== episode.updatedAt) {
    setSeenUpdatedAt(episode.updatedAt);
    setState(startingState(episode, state));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);

  const saved = useMemo(() => valuesOf(episode), [episode]);
  const dirty = !sameValues(state, saved);
  // The draft started from an older version than the one on disk now.
  const stale = dirty && state.baseUpdatedAt !== episode.updatedAt;

  // Mirror edits into the draft (or drop it when nothing differs from the saved version).
  useEffect(() => {
    if (dirty) saveDraft(episode.slug, state);
    else clearDraft(episode.slug);
  }, [state, dirty, episode.slug]);

  const update = (patch: Partial<EditorValues>) => setState((s) => ({ ...s, ...patch }));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const guestDescriptions = Object.fromEntries(
        state.guests.flatMap((name) => {
          const description = Object.hasOwn(state.guestDescriptions, name)
            ? state.guestDescriptions[name]?.trim()
            : undefined;
          return description ? [[name, description]] : [];
        }),
      );
      const result = await api.save(episode.slug, {
        expectedUpdatedAt: episode.updatedAt,
        summary: summaryPoints(state.summary),
        notes: state.notes,
        tags: state.tags,
        guests: state.guests,
        guestDescriptions:
          episode.guestDescriptions || Object.keys(guestDescriptions).length > 0
            ? guestDescriptions
            : undefined,
      });
      clearDraft(episode.slug);
      setConflict(false);
      flashAfterWrite(
        "success",
        result.written ? "Salvato" : "Nessuna modifica da salvare",
        result.written ? `Campi aggiornati: ${result.changedFields.join(", ")}` : undefined,
      );
      onOpenChange(false);
      if (result.written) window.location.reload();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        setConflict(true);
        setError(undefined);
      } else {
        setError(describeError(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    clearDraft(episode.slug);
    setState({ ...saved, baseUpdatedAt: episode.updatedAt, base: saved });
    setConflict(false);
    setError(undefined);
    toast.info("Bozza scartata.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifica episodio</DialogTitle>
          <DialogDescription>
            Il testo resta come bozza in questa scheda finché non salvi: una ricarica della pagina
            non lo perde.
          </DialogDescription>
        </DialogHeader>

        {conflict && (
          <Alert variant="destructive">
            <AlertTitle>Conflitto di versione</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                L'episodio è stato modificato altrove (per esempio da una skill) mentre scrivevi: il
                salvataggio è stato rifiutato. Il tuo testo è al sicuro nella bozza.
              </p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden /> Ricarica la versione aggiornata (tieni la bozza)
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {stale && !conflict && (
          <Alert>
            <AlertTitle>Bozza basata su una versione precedente</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                L'episodio è cambiato dopo che hai iniziato a scrivere. I campi che hai modificato
                sono la tua bozza, gli altri sono quelli aggiornati; salvando sovrascrivi i campi
                modificati.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">Mostra la versione salvata</summary>
                <SavedVersion values={saved} />
              </details>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={discard}>
                  <Trash2 aria-hidden /> Scarta la bozza
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Salvataggio rifiutato</AlertTitle>
            <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="edit-summary">In breve (un punto per riga)</Label>
            <Textarea
              id="edit-summary"
              rows={5}
              value={state.summary}
              onChange={(event) => update({ summary: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Appunti (markdown)</Label>
            <Textarea
              id="edit-notes"
              rows={12}
              className="font-mono text-sm"
              value={state.notes}
              onChange={(event) => update({ notes: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tag</Label>
            <TagInput
              values={state.tags}
              onChange={(tags) => update({ tags })}
              suggestions={suggestions}
              hint="Inglese e minuscolo; scegli tra i tag esistenti quando possibile."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ospiti</Label>
            <GuestsInput values={state.guests} onChange={(guests) => update({ guests })} />
            {state.guests.map((name, index) => {
              const id = `edit-guest-description-${index}`;
              return (
                <div key={name} className="mt-3 space-y-1.5">
                  <Label htmlFor={id}>Presentazione di {name}</Label>
                  <Textarea
                    id={id}
                    rows={2}
                    maxLength={GUEST_DESCRIPTION_MAX_LENGTH}
                    value={
                      Object.hasOwn(state.guestDescriptions, name)
                        ? state.guestDescriptions[name]
                        : ""
                    }
                    onChange={(event) =>
                      update({
                        guestDescriptions: {
                          ...state.guestDescriptions,
                          [name]: event.target.value,
                        },
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={discard} disabled={!dirty}>
            Annulla modifiche
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Chiudi
            </Button>
            <Button disabled={saving || !dirty} onClick={() => void save()}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Salva
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SavedVersion({ values }: { values: EditorValues }) {
  return (
    <dl className="mt-2 space-y-2 rounded-md border bg-background p-2">
      {(
        [
          ["In breve", values.summary],
          ["Appunti", values.notes],
          ["Tag", values.tags.join(", ")],
          ["Ospiti", values.guests.join(", ")],
          [
            "Presentazioni degli ospiti",
            Object.entries(values.guestDescriptions)
              .map(([name, description]) => `${name} — ${description}`)
              .join("\n"),
          ],
        ] as const
      ).map(([label, text]) => (
        <div key={label}>
          <dt className="font-medium">{label}</dt>
          <dd className="max-h-32 overflow-auto whitespace-pre-wrap text-muted-foreground">
            {text || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
