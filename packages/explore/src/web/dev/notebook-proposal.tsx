/*
 * The card of the `propose_notebook` tool: the new text of the notebook, editable, and two ways to save it. Nothing is
 * saved until the user clicks one of the buttons. Dev-only, like the proposal card in `dev-tools.tsx`.
 */
import { CheckIcon, NotebookPenIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { ToolPartInfo } from "@ehub/chat/web";
import { Button } from "@ehub/ui/components/button";
import { Textarea } from "@ehub/ui/components/textarea";
import { ProposeNotebookInput } from "../../chat/notebook.ts";
import type { Exploration } from "../../schema.ts";
import type { ExploreStore } from "../store.ts";

export function NotebookProposalCard({
  exploration,
  part,
  store,
}: {
  exploration: Exploration;
  part: ToolPartInfo;
  store: ExploreStore;
}) {
  if (part.state === "input-streaming") {
    return <p className="text-sm text-muted-foreground">Preparo la proposta…</p>;
  }
  const parsed = ProposeNotebookInput.safeParse(part.input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "formato non valido";
    return (
      <div role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        Non riesco a mostrare la proposta del quaderno: {message}. Nessuna modifica è stata fatta.
      </div>
    );
  }
  return <NotebookProposalForm exploration={exploration} proposed={parsed.data.body} store={store} />;
}

function NotebookProposalForm({
  exploration,
  proposed,
  store,
}: {
  exploration: Exploration;
  proposed: string;
  store: ExploreStore;
}) {
  const id = useId();
  const [text, setText] = useState(proposed);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const current = exploration.notebook?.body.length ?? 0;
  // An empty text would clear the notebook when replacing it: the buttons stay off until there is text.
  const empty = text.trim() === "";

  const save = async (mode: "replace" | "append") => {
    const body = text.trim();
    setSaving(true);
    try {
      if (mode === "replace") {
        await store.setNotebook(exploration.id, body);
        toast.success("Quaderno aggiornato");
      } else {
        await store.appendNotebook(exploration.id, body);
        toast.success("Aggiunto in fondo al quaderno");
      }
      setSaved(true);
    } catch (error) {
      toast.error((error as Error).message || "Salvataggio non riuscito.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Proposta del quaderno" className="rounded-xl border border-brand/30 bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <NotebookPenIcon aria-hidden className="size-4 text-brand" /> Proposta per il quaderno
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Niente è salvato finché non confermi. Puoi modificare il testo prima di salvarlo.
      </p>

      <Textarea
        id={id}
        aria-label="Testo del quaderno proposto"
        rows={12}
        className="mt-3"
        value={text}
        disabled={saving || saved}
        onChange={(event) => setText(event.target.value)}
      />
      {!saved && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sostituisce l&apos;intero quaderno (ora {current === 0 ? "vuoto" : `${current} caratteri`}).
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {saved ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
            <CheckIcon aria-hidden className="size-4" /> Salvato
          </span>
        ) : (
          <>
            <Button variant="outline" onClick={() => void save("append")} disabled={saving || empty}>
              Aggiungi in fondo
            </Button>
            <Button onClick={() => void save("replace")} disabled={saving || empty}>
              Sostituisci il quaderno
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
