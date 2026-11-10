import { useState } from "react";
import { Check, ClipboardCopy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Episode } from "@core/schema";
import { Button } from "@ehub/ui/components/button";
import { api, describeError } from "./api";
import { copyText } from "./clipboard";

/** "Copia per l'agente": the compact markdown export (§4.4) onto the clipboard. */
export function CopyForAgent({ episode }: { episode: Episode }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const copy = async () => {
    setState("busy");
    try {
      const markdown = await api.exportMarkdown(episode.slug);
      await copyText(markdown);
      const words = markdown.split(/\s+/).filter(Boolean).length;
      toast.success("Copiato negli appunti", {
        description: `Trascrizione in markdown compatto, circa ${words.toLocaleString("it-IT")} parole: incollala nell'agente.`,
      });
      setState("done");
      window.setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      toast.error("Copia non riuscita", { description: describeError(e) });
      setState("idle");
    }
  };

  return (
    <Button variant="outline" onClick={() => void copy()} disabled={state === "busy"}>
      {state === "busy" ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : state === "done" ? (
        <Check aria-hidden />
      ) : (
        <ClipboardCopy aria-hidden />
      )}
      Copia per l'agente
    </Button>
  );
}
