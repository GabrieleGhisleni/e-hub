import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Episode } from "@core/schema";
import { copyText } from "./clipboard";

/** `<li>` badge "Nessuna trascrizione" with the copyable local command (the slot sits in a `<ul>`). */
export function NoTranscriptBadge({ episode }: { episode: Episode }) {
  const command = `pnpm transcribe ${episode.slug}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable: the command stays visible on hover via title.
    }
  };
  return (
    <li className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs">
        Nessuna trascrizione
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copia il comando"
        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {copied ? (
          <Check className="size-3" aria-hidden />
        ) : (
          <Copy className="size-3" aria-hidden />
        )}
        <span className="max-w-[18rem] truncate sm:max-w-none">{command}</span>
      </button>
    </li>
  );
}
