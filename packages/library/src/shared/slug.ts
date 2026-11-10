import type { Book } from "./schema.ts";
import { slugify } from "./text.ts";

export { slugify } from "./text.ts";

export const BOOK_SLUG_MAX_LENGTH = 80;

/** Lowercase particles kept with the surname ("Ludwig van Beethoven" → "van Beethoven"). */
const SURNAME_PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "de",
  "del",
  "della",
  "dei",
  "degli",
  "di",
  "da",
  "dal",
  "dalla",
  "du",
  "des",
  "do",
  "dos",
  "das",
  "la",
  "le",
  "lo",
  "ten",
  "ter",
  "y",
  "bin",
  "ibn",
  "al",
]);

const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;

/**
 * Best-effort surname of an author in display form: "Daniel Kahneman" → "Kahneman",
 * "Kahneman, Daniel" → "Kahneman", "Ludwig van Beethoven" → "van Beethoven", "Omero" → "Omero".
 */
export function authorSurname(author: string): string {
  const trimmed = author.trim();
  const comma = trimmed.indexOf(",");
  if (comma > 0) return trimmed.slice(0, comma).trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  while (words.length > 1 && NAME_SUFFIX.test(words.at(-1) ?? "")) words.pop();
  if (words.length <= 1) return words[0] ?? "";
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has((words[start - 1] ?? "").toLowerCase())) start -= 1;
  return words.slice(start).join(" ");
}

/** Readable URL slug, e.g. `kahneman-thinking-fast-and-slow`. Cosmetic only: the ID identifies the book. */
export function bookSlug(book: Pick<Book, "title" | "authors">): string {
  const surname = authorSurname(book.authors[0] ?? "");
  return slugify(`${surname} ${book.title}`, BOOK_SLUG_MAX_LENGTH) || "libro";
}
