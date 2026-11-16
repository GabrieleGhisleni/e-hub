/*
 * The card of the `propose_book_notes` tool: the proposed Appunti of the book, editable, with one button to apply them.
 * Nothing is saved until the user clicks it. Dev-only, like the other chat cards.
 */
import { CheckIcon, PencilLineIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { ToolPartInfo } from "@ehub/chat/web";
import { Button } from "@ehub/ui/components/button";
import { Label } from "@ehub/ui/components/label";
import { Textarea } from "@ehub/ui/components/textarea";
import { ProposeBookNotesInput } from "@shared/chat-edit";
import type { BookDetail } from "@shared/schema";
import { adminApi } from "./api";
import { friendlyMessage } from "./lib/errors";

export function BookNotesCard({ book, part }: { book: BookDetail; part: ToolPartInfo }) {
  if (part.state === "input-streaming") {
    return <p className="text-sm text-muted-foreground">Preparo la proposta…</p>;
  }
  const parsed = ProposeBookNotesInput.safeParse(part.input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "formato non valido";
    return (
      <output className="block rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        Non riesco a mostrare la proposta: {message}. Nessuna modifica è stata fatta.
      </output>
    );
  }
  return <NotesForm book={book} proposed={parsed.data.notes} />;
}

function NotesForm({ book, proposed }: { book: BookDetail; proposed: string }) {
  const id = useId();
  const [notes, setNotes] = useState(proposed);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const locked = saving || saved;

  const apply = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const result = await adminApi.saveNotes(book.id, notes);
      toast.success(result.written ? "Appunti aggiornati" : "Nessuna modifica da salvare");
      setSaved(true);
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Proposta di appunti"
      className="rounded-xl border border-brand/30 bg-card p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <PencilLineIcon aria-hidden className="size-4 text-brand" /> Proposta di appunti
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Il testo sostituisce gli Appunti attuali. Niente è salvato finché non confermi: puoi correggerlo prima.
      </p>
      <div className="mt-3">
        <Label htmlFor={`${id}-notes`}>Appunti (Markdown)</Label>
        <Textarea
          id={`${id}-notes`}
          rows={12}
          className="mt-1"
          value={notes}
          disabled={locked}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
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
          <Button onClick={() => void apply()} disabled={saving || notes.trim() === ""}>
            Applica agli Appunti
          </Button>
        )}
      </div>
    </section>
  );
}
