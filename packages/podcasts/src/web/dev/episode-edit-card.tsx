/*
 * The card of the `propose_episode_edit` tool: the proposed summary / Appunti / tags / guests, editable, with one
 * button to apply them. Nothing is saved until the user clicks it. Dev-only, like the other chat cards.
 */
import { useId, useState } from "react";
import { CheckIcon, PencilLineIcon } from "lucide-react";
import { toast } from "sonner";
import type { ToolPartInfo } from "@ehub/chat/web";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import { Textarea } from "@ehub/ui/components/textarea";
import { ProposeEpisodeEditInput } from "@core/chat-edit";
import type { Episode } from "@core/schema";
import { api, describeError } from "./api";
import { flashAfterWrite } from "./storage";

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function EpisodeEditCard({ episode, part }: { episode: Episode; part: ToolPartInfo }) {
  if (part.state === "input-streaming") {
    return <p className="text-sm text-muted-foreground">Preparo la proposta…</p>;
  }
  const parsed = ProposeEpisodeEditInput.safeParse(part.input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "formato non valido";
    return (
      <output className="block rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        Non riesco a mostrare la proposta: {message}. Nessuna modifica è stata fatta.
      </output>
    );
  }
  return <EditForm episode={episode} proposed={parsed.data} />;
}

function EditForm({ episode, proposed }: { episode: Episode; proposed: ProposeEpisodeEditInput }) {
  const id = useId();
  const [summary, setSummary] = useState(proposed.summary?.join("\n"));
  const [notes, setNotes] = useState(proposed.notes);
  const [tags, setTags] = useState(proposed.tags?.join(", "));
  const [guests, setGuests] = useState(proposed.guests?.join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const locked = saving || saved;

  const apply = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const result = await api.save(episode.slug, {
        expectedUpdatedAt: episode.updatedAt,
        ...(summary !== undefined ? { summary: lines(summary) } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(tags !== undefined ? { tags: list(tags) } : {}),
        ...(guests !== undefined ? { guests: list(guests) } : {}),
      });
      flashAfterWrite(
        "success",
        result.written ? "Scheda aggiornata" : "Nessuna modifica da salvare",
        result.written ? `Campi aggiornati: ${result.changedFields.join(", ")}` : undefined,
      );
      toast.success(result.written ? "Scheda aggiornata" : "Nessuna modifica da salvare");
      setSaved(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Proposta di modifica" className="rounded-xl border border-brand/30 bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <PencilLineIcon aria-hidden className="size-4 text-brand" /> Proposta di modifica
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Ogni campo qui sotto sostituisce quello attuale. Niente è salvato finché non confermi: puoi correggere il testo prima.
      </p>

      {summary !== undefined && (
        <div className="mt-3">
          <Label htmlFor={`${id}-summary`}>Punti chiave (uno per riga)</Label>
          <Textarea id={`${id}-summary`} rows={5} className="mt-1" value={summary} disabled={locked} onChange={(e) => setSummary(e.target.value)} />
        </div>
      )}
      {notes !== undefined && (
        <div className="mt-3">
          <Label htmlFor={`${id}-notes`}>Appunti (Markdown)</Label>
          <Textarea id={`${id}-notes`} rows={10} className="mt-1" value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}
      {tags !== undefined && (
        <div className="mt-3">
          <Label htmlFor={`${id}-tags`}>Tag (separati da virgola)</Label>
          <Input id={`${id}-tags`} className="mt-1" value={tags} disabled={locked} onChange={(e) => setTags(e.target.value)} />
        </div>
      )}
      {guests !== undefined && (
        <div className="mt-3">
          <Label htmlFor={`${id}-guests`}>Ospiti (separati da virgola)</Label>
          <Input id={`${id}-guests`} className="mt-1" value={guests} disabled={locked} onChange={(e) => setGuests(e.target.value)} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 whitespace-pre-line text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? (
          <output className="inline-flex items-center gap-1.5 font-medium text-brand">
            <CheckIcon aria-hidden className="size-4" /> Applicato
          </output>
        ) : (
          <Button onClick={() => void apply()} disabled={saving}>
            Applica alla scheda
          </Button>
        )}
      </div>
    </section>
  );
}
