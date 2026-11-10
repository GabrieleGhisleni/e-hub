/**
 * Small isomorphic text helpers shared by slugs, IDs and Drive names.
 * No Node APIs: this runs in the browser too.
 */

/** Letters that NFKD does not decompose into ASCII + combining marks. */
const EXTRA_FOLDS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "Th",
  ı: "i",
};

/** Folds diacritics and a few special letters to ASCII ("dèi" → "dei", "Straße" → "Strasse"). */
export function foldToAscii(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßẞæÆœŒøØđĐðÐłŁþÞı]/g, (ch) => EXTRA_FOLDS[ch] ?? ch);
}

/**
 * ASCII slug: lowercase, diacritics folded, every run of other characters becomes one "-".
 * When `maxLength` is given the slug is cut at a "-" boundary when possible.
 */
export function slugify(input: string, maxLength?: number): string {
  const slug = foldToAscii(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (maxLength === undefined || slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash >= maxLength / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Splits a string into user-perceived characters (never cuts a surrogate pair or a combining sequence). */
export function graphemes(input: string): string[] {
  return Array.from(graphemeSegmenter.segment(input), (s) => s.segment);
}

const utf8 = new TextEncoder();

export function utf8Length(input: string): number {
  return utf8.encode(input).length;
}
