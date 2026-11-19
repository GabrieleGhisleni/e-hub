import { useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
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
import { Label } from "@ehub/ui/components/label";
import { Textarea } from "@ehub/ui/components/textarea";
import { plural } from "@podcasts/lib/format";
import { api, describeError } from "./api";
import { flashAfterWrite } from "./storage";

/** Message shown after saving a conversation (also unit-tested). */
export function conversationOutcome(result: {
  added: number;
  skipped: number;
  excerptsRemoved: number;
}): { kind: "success" | "info"; message: string; description?: string } {
  if (result.added === 0) {
    return { kind: "info", message: "Conversazione già presente: nessuna modifica." };
  }
  return {
    kind: "success",
    message: "Conversazione aggiunta",
    description:
      result.excerptsRemoved > 0
        ? `${plural(result.excerptsRemoved, "estratto della trascrizione rimosso", "estratti della trascrizione rimossi")}.`
        : "Nessun estratto della trascrizione da rimuovere.",
  };
}

/** Button + dialog "Aggiungi conversazione" in the conversations header. */
export function AddConversation({ episode }: { episode: Episode }) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("Claude");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.addConversation(episode.slug, { agent, markdown });
      const outcome = conversationOutcome(result.conversations);
      flashAfterWrite(outcome.kind, outcome.message, outcome.description);
      setMarkdown("");
      setOpen(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Aggiungi conversazione"
          title="Aggiungi conversazione"
        >
          <MessageSquarePlus aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aggiungi conversazione</DialogTitle>
          <DialogDescription>
            Incolla la chat in markdown. Le sequenze di 20 o più parole identiche alla trascrizione
            locale vengono rimosse prima del salvataggio.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Salvataggio rifiutato</AlertTitle>
            <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conv-agent">Agente</Label>
            <Input
              id="conv-agent"
              value={agent}
              placeholder="Claude, ChatGPT, …"
              onChange={(event) => setAgent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-markdown">Conversazione (markdown)</Label>
            <Textarea
              id="conv-markdown"
              rows={14}
              className="font-mono text-sm"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !agent.trim() || !markdown.trim()}
            onClick={() => void submit()}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Salva conversazione
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
