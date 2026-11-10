/**
 * Slug generation (DESIGN.md §13). Pure and isomorphic.
 */
import { SLUG_MAX_LENGTH, isValidSlug } from "./schema";

/** Max length of generated episode slugs (`<show>-<title>`, plus any `-N` suffix). */
export const EPISODE_SLUG_MAX_LENGTH = 80;

/**
 * Turns free text into a slug fragment: diacritics stripped, lowercase,
 * apostrophes dropped ("don't" → "dont"), every other run of non-alphanumerics
 * becomes one hyphen; truncated at a word boundary to `maxLength`.
 * May return "" (e.g. for text with no Latin letters or digits).
 */
export function slugify(text: string, maxLength = SLUG_MAX_LENGTH): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateSlug(slug, maxLength);
}

/** Cuts a slug to `maxLength`, preferring a hyphen boundary, never leaving a trailing hyphen. */
export function truncateSlug(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;
  let cut = slug.slice(0, maxLength);
  if (slug[maxLength] !== "-") {
    const lastHyphen = cut.lastIndexOf("-");
    // Keep a partial word only when the slug would otherwise shrink too much.
    if (lastHyphen >= maxLength / 2) cut = cut.slice(0, lastHyphen);
  }
  return cut.replace(/-+$/, "");
}

/**
 * Generates a unique, regex-valid episode slug `<show>-<title-in-kebab-case>`,
 * truncated to `maxLength`. A leading repetition of the show name in the title
 * is dropped ("Huberman Lab Essentials: …" → `huberman-lab-essentials-…`).
 * If the slug is taken, `-2`, `-3`, … is appended (still within `maxLength`).
 */
export function generateEpisodeSlug(
  showSlug: string,
  title: string,
  isTaken: (slug: string) => boolean,
  maxLength = EPISODE_SLUG_MAX_LENGTH,
): string {
  let titleSlug = slugify(title, SLUG_MAX_LENGTH);
  if (titleSlug === showSlug) titleSlug = "";
  else if (titleSlug.startsWith(`${showSlug}-`)) titleSlug = titleSlug.slice(showSlug.length + 1);
  const base = [showSlug, titleSlug || "episode"].join("-");

  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = truncateSlug(base, maxLength - suffix.length) + suffix;
    if (!isValidSlug(candidate))
      throw new Error(`cannot build a valid slug from show '${showSlug}' and title '${title}'`);
    if (!isTaken(candidate)) return candidate;
  }
}
