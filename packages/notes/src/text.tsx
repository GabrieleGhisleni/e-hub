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
