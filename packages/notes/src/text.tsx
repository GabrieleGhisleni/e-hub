import { Fragment, type ReactNode } from "react";

/** Lowercase, without diacritics ("Perché" matches "perche"). */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

export function searchTokens(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/** Every token must appear somewhere in the given fields. */
export function matchesTokens(
  tokens: readonly string[],
  ...fields: (string | undefined)[]
): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalize(fields.filter(Boolean).join("\n"));
  return tokens.every((token) => haystack.includes(token));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wraps search matches in <mark> (case-insensitive; accents must match for the highlight). */
export function highlight(text: string, tokens: readonly string[]): ReactNode {
  if (tokens.length === 0) return text;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-[3px] bg-brand-soft px-0.5 text-foreground ring-1 ring-brand/25"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Note body: URLs become links, the rest keeps its line breaks (the container uses `whitespace-pre-wrap`). */
export function NoteText({ text, tokens = [] }: { text: string; tokens?: readonly string[] }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          >
            {highlight(part, tokens)}
          </a>
        ) : (
          <Fragment key={i}>{highlight(part, tokens)}</Fragment>
        ),
      )}
    </>
  );
}

const dayFormat = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });

/** "oggi, 14:32" · "ieri, 09:10" · "3 nov 2026". */
export function formatNoteDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `oggi, ${timeFormat.format(date)}`;
  if (days === 1) return `ieri, ${timeFormat.format(date)}`;
  return dayFormat.format(date);
}

export function notesCount(count: number): string {
  return count === 1 ? "1 nota" : `${count} note`;
}
