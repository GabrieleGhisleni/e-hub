/**
 * Pure text helpers for ingest: whitespace, entity decoding, title
 * normalisation for matching, episode numbers, and the "looks like a person's
 * name" heuristic used to extract guests (DESIGN.md §6).
 */

/** Collapses runs of whitespace (incl. NBSP) and trims. */
export function cleanText(text: string): string {
  return text.replace(/[\s ]+/g, " ").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** Decodes numeric and the common named HTML entities (for text pulled out with regexes). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Letters that NFKD does not decompose. */
const FOLDED_LETTERS: Record<string, string> = {
  ø: "o",
  ł: "l",
  đ: "d",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  þ: "th",
};

/**
 * Canonical form of an episode title for matching across sources (YouTube,
 * feed, wiki): lowercase, no diacritics, `&` → "and", honorifics dropped,
 * punctuation removed, single spaces.
 */
export function normalizeTitle(title: string): string {
  return decodeEntities(title)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øłđßæœþ]/g, (char) => FOLDED_LETTERS[char] ?? char)
    .replace(/&/g, " and ")
    .replace(/['’ʼ`]/g, "")
    .replace(/\b(dr|prof|mr|mrs|ms)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Titles match if their normalised forms are equal, or one is a prefix of the
 * other (at a word boundary, shorter one ≥ 20 chars): YouTube titles often add
 * a suffix, e.g. "… | Dr. Alok Kanojia (Healthy Gamer)" vs "… | Dr. Alok Kanojia".
 */
export function titlesMatch(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 20 && long.startsWith(`${short} `);
}

/** Episode number from a title: `#502`, `Ep. 12`, `Episode 7`, `EP-374`. */
export function episodeNumberFromTitle(title: string): number | undefined {
  const match = /(?:^|[\s(|[])(?:#|ep(?:isode)?\.?\s*-?\s*)(\d{1,5})\b/i.exec(title);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** `YYYY-MM-DD` of a date/datetime string, keeping the date as written (no timezone shift). */
export function isoDatePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value.trim());
  return match ? match[1] : undefined;
}

/** `YYYY-MM-DD` (UTC) of an RFC 822 date as used in RSS `pubDate`. */
export function rfc822ToIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Person names

const HONORIFIC = /^(?:dr|prof|professor|sir|mr|mrs|ms)\.?\s+/i;
const NAME_PARTICLES = new Set([
  "de",
  "da",
  "das",
  "do",
  "dos",
  "di",
  "du",
  "del",
  "della",
  "der",
  "den",
  "van",
  "von",
  "la",
  "le",
  "bin",
  "ibn",
  "al",
  "el",
  "ter",
  "ten",
  "y",
]);
/** First words that start titles and sentences, never names. */
const NOT_A_NAME_START = new Set([
  "a",
  "an",
  "the",
  "how",
  "why",
  "what",
  "when",
  "where",
  "who",
  "which",
  "is",
  "are",
  "do",
  "does",
  "can",
  "will",
  "should",
  "this",
  "that",
  "these",
  "my",
  "our",
  "your",
  "his",
  "her",
  "their",
  "we",
  "i",
  "you",
  "he",
  "she",
  "they",
  "it",
  "essentials",
  "episode",
  "live",
  "ama",
  "introducing",
  "introduction",
  "tools",
  "science",
  "debate",
  "special",
  "bonus",
  "best",
  "top",
  "new",
  "part",
  "interview",
  "podcast",
  "guest",
  "guests",
]);

/** Last words that make a capitalised phrase a label, not a person ("Cursor Team", "Israel-Palestine Debate"). */
const NOT_A_NAME_END = new Set([
  "debate",
  "interview",
  "team",
  "podcast",
  "show",
  "episode",
  "panel",
  "roundtable",
  "special",
  "highlights",
  "live",
]);

/** Strips honorifics ("Dr."), parentheticals ("(aka DHH)", "(Healthy Gamer)") and stray punctuation. */
export function cleanPersonName(name: string): string {
  return cleanText(name.replace(/\s*\([^)]*\)/g, " "))
    .replace(HONORIFIC, "")
    .replace(/^[\s"'“”‘’,.;:–—-]+|[\s"'“”‘’,;:–—-]+$/g, "")
    .trim();
}

/**
 * Heuristic: 2–5 capitalised words (particles like "van", "de" allowed), no
 * digits or sentence punctuation, not starting with a title word ("How",
 * "The", …). `allowSingleWord` admits one-word names such as "DHH" or
 * "ThePrimeagen" (only used where the context makes a name very likely).
 */
export function looksLikePersonName(
  text: string,
  options: { allowSingleWord?: boolean } = {},
): boolean {
  const name = cleanPersonName(text);
  if (!name || name.length > 60) return false;
  if (/[\d?!&:;|/@#…"“”]/.test(name)) return false;
  const words = name.split(" ");
  if (words.length > 5) return false;
  if (words.length === 1 && !options.allowSingleWord) return false;
  if (NOT_A_NAME_START.has(words[0]!.toLowerCase())) return false;
  if (words.length > 1 && NOT_A_NAME_END.has(words.at(-1)!.toLowerCase())) return false;
  let capitalised = 0;
  for (const word of words) {
    if (NAME_PARTICLES.has(word.toLowerCase()) && word !== words[0]) continue;
    // Initials ("J.", "R.R.") and hyphenated/apostrophe names ("Jean-Baptiste", "O'Neil").
    if (!/^\p{Lu}[\p{L}'’.-]*$/u.test(word)) return false;
    capitalised++;
  }
  return capitalised >= Math.min(words.length, 1);
}

/** Splits "A, B and C" / "A & B" / "A, B, and C" into names. */
export function splitNameList(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+(?:and|&)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Every name of a list if all of them look like person names, else `[]`. */
export function namesFromList(text: string, options: { allowSingleWord?: boolean } = {}): string[] {
  const parts = splitNameList(cleanText(text.replace(/\s*\([^)]*\)/g, " ")));
  if (parts.length === 0) return [];
  const allowSingleWord = options.allowSingleWord ?? false;
  if (!parts.every((part) => looksLikePersonName(part, { allowSingleWord }))) return [];
  return parts.map(cleanPersonName);
}

const ABBREVIATIONS = /\b(?:dr|mr|mrs|ms|prof|st|jr|sr|vs|etc|inc|u\.s|e\.g|i\.e)\.$/i;

/** Splits prose into sentences, not breaking after common abbreviations ("Dr.", "Jr.", "U.S."). */
export function splitSentences(text: string): string[] {
  const pieces = cleanText(text).split(/(?<=[.!?])\s+(?=[\p{Lu}"“])/u);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const previous = sentences.at(-1);
    if (previous !== undefined && ABBREVIATIONS.test(previous))
      sentences[sentences.length - 1] = `${previous} ${piece}`;
    else sentences.push(piece);
  }
  return sentences.filter(Boolean);
}

/**
 * Guests introduced by a description ("Andrew Scull is a historian…",
 * "Ankur Moitra, Steven Brunton and Alex Kontorovich are…", then later
 * sentences "Amanda Askell is…"). One-word subjects ("DHH") are accepted only
 * in the first sentence; later sentences need full names (so "Nathan is…"
 * after "Nathan Lambert and … are…" does not add a guest).
 */
export function guestsFromDescription(description: string): string[] {
  const guests: string[] = [];
  const add = (names: string[]) => {
    for (const name of names) {
      const known = guests.some(
        (guest) => guest === name || guest.split(" ").includes(name) || name.includes(guest),
      );
      if (!known) guests.push(name);
    }
  };
  splitSentences(description).forEach((sentence, index) => {
    const match = /^(.+?)\s+(?:\([^)]*\)\s+)?(?:is|are|was|were)\s/u.exec(sentence);
    if (!match) return;
    const names = namesFromList(match[1]!, { allowSingleWord: index === 0 });
    if (index > 0 && names.some((name) => !name.includes(" "))) return;
    add(names);
  });
  return guests;
}

/**
 * Guests from a title, by position: "topic | Guest" (Huberman and many
 * YouTube channels; the last pipe part that is not the channel), then
 * "Guest: topic", then "Guest — topic" / "topic – Guest" (only if exactly one
 * end is a name). A leading "#123 – " is ignored. `exclude` lists names that
 * are never guests (channel, show, host). Title-cased topics ("Unlearn
 * Negative Thoughts") can look like names, which is why position matters.
 */
export function guestsFromTitle(title: string, options: { exclude?: string[] } = {}): string[] {
  const excluded = new Set((options.exclude ?? []).map(normalizeTitle));
  const names = (part: string | undefined) =>
    part === undefined
      ? []
      : namesFromList(part).filter((name) => !excluded.has(normalizeTitle(name)));

  const pipeParts = cleanText(decodeEntities(title)).split(/\s+\|\s+/);
  for (const part of pipeParts.slice(1).reverse()) {
    const found = names(part);
    if (found.length) return found;
  }
  const main = pipeParts[0]!.replace(/^#\d+\s*[–—-]\s*/, "");
  const colon = main.indexOf(": ");
  if (colon > 0) {
    const found = names(main.slice(0, colon));
    if (found.length) return found;
  }
  const dashParts = main.split(/\s+[–—-]\s+/);
  if (dashParts.length > 1) {
    // Decide which end is the name before dropping excluded names: in
    // "Channel Name - Title Cased Song", the head is a name (the channel), so
    // the tail is the topic, not a guest.
    const headLooksLikeNames = namesFromList(dashParts[0]!).length > 0;
    const tailLooksLikeNames = namesFromList(dashParts.at(-1)!).length > 0;
    if (headLooksLikeNames && !tailLooksLikeNames) return names(dashParts[0]);
    if (tailLooksLikeNames && !headLooksLikeNames) return names(dashParts.at(-1));
  }
  return [];
}

/** Dedupes names (case/diacritics-insensitive), keeping the first spelling and order. */
export function uniqueNames(names: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const clean = cleanText(name);
    const key = normalizeTitle(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}
