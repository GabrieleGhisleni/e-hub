import { slugify } from "./text.ts";

/** Crockford base32, lowercase: no i, l, o, u. */
export const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const BOOK_ID_LENGTH = 8;
export const BOOK_ID_PATTERN = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;

/** Topic IDs are ASCII slugs ("unsorted", "storia-antica"). */
export const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TOPIC_ID_MAX_LENGTH = 48;

/** Returns a float in [0, 1), like Math.random. */
export type Rng = () => number;

/** Cryptographic RNG (Web Crypto, available in Node and browsers). 2^32 is a multiple of 32: no modulo bias. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 2 ** 32;
};

export function isBookId(value: unknown): value is string {
  return typeof value === "string" && BOOK_ID_PATTERN.test(value);
}

/**
 * New random book ID, unique among `existing` (pass every folder name in data/books, incomplete ones included).
 * Throws after 1000 collisions, which only happens with a broken `rng`.
 */
export function generateBookId(existing: ReadonlySet<string>, rng: Rng = cryptoRng): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = "";
    for (let i = 0; i < BOOK_ID_LENGTH; i++) {
      const index = Math.min(Math.floor(rng() * 32), 31);
      id += CROCKFORD_ALPHABET[index];
    }
    if (!existing.has(id)) return id;
  }
  throw new Error(
    "generateBookId: could not find a free ID after 1000 attempts (is the RNG broken?)",
  );
}

export function isTopicId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= TOPIC_ID_MAX_LENGTH && TOPIC_ID_PATTERN.test(value)
  );
}

/**
 * Stable topic ID derived from its label at creation time: ASCII slug ("Storia antica" → "storia-antica"),
 * deduplicated against `existingIds` with "-2", "-3"… Labels without letters or digits become "topic".
 */
export function topicIdFromLabel(label: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  const base = slugify(label, TOPIC_ID_MAX_LENGTH - 4) || "topic";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
