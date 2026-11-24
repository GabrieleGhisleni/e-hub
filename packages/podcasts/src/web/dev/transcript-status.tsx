import type { Episode } from "@core/schema";

/** `<li>` badge "Nessuna trascrizione" (the slot sits in a `<ul>`). */
export function NoTranscriptBadge(_props: { episode: Episode }) {
  return (
    <li className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs">
        Nessuna trascrizione
      </span>
    </li>
  );
}
