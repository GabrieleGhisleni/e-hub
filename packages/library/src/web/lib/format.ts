/**
 * Italian display formatting for the public site. Pure functions (Intl only), unit-tested in test/web.
 */

const dateFormat = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `2025-03-04` → "4 marzo 2025". Returns the input unchanged if it is not a valid ISO date. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

/** "Mario Rossi", "Mario Rossi e Anna Bianchi", "A, B e C". */
export function formatAuthors(authors: readonly string[]): string {
  if (authors.length <= 1) return authors[0] ?? "";
  return `${authors.slice(0, -1).join(", ")} e ${authors.at(-1)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

let languageNames: Intl.DisplayNames | null | undefined;

/** BCP 47 tag → Italian name: "en-US" → "Inglese (Stati Uniti)", "it" → "Italiano". Unknown tags pass through. */
export function formatLanguage(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return tag;
  if (languageNames === undefined) {
    try {
      languageNames = new Intl.DisplayNames(["it"], { type: "language" });
    } catch {
      languageNames = null;
    }
  }
  try {
    const name = languageNames?.of(trimmed);
    return name && name.toLowerCase() !== trimmed.toLowerCase() ? capitalize(name) : trimmed;
  } catch {
    return trimmed;
  }
}

/** "1 libro", "3 libri". */
export function booksCount(count: number): string {
  return `${count} ${count === 1 ? "libro" : "libri"}`;
}

/** Result line for the grid: "16 libri", or "3 di 16 libri" when filtered. */
export function resultCountLabel(shown: number, total: number): string {
  if (shown === total) return booksCount(total);
  return `${shown} di ${booksCount(total)}`;
}

/** Description text → paragraphs (blank lines separate them; single newlines are kept as spaces). */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p !== "");
}

/** Placeholder cover tones (see `.cover-placeholder` in index.css). */
export const PLACEHOLDER_TONES = 6;

/** Stable tone for a book without a cover, from its ID. */
export function placeholderTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % PLACEHOLDER_TONES;
}

/** Path (inside the router basename) of a book page. */
export function bookHref(book: { id: string; slug: string }): string {
  return book.slug ? `/book/${book.id}/${book.slug}` : `/book/${book.id}`;
}
