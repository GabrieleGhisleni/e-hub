/** Tag helpers for the admin forms. Pure and DOM-free (unit-tested). Tags are free text, compared folded. */

/** Trims and collapses inner whitespace. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Case/accent-insensitive key (the server compares bulk tags the same way). */
export function foldTag(tag: string): string {
  return normalizeTag(tag)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Adds `raw` (possibly several, comma/semicolon separated) to `tags`, skipping blanks and folded duplicates. */
export function addTags(tags: readonly string[], raw: string): string[] {
  const out = [...tags];
  const seen = new Set(out.map(foldTag));
  for (const part of raw.split(/[,;\n]/)) {
    const tag = normalizeTag(part);
    if (tag === "") continue;
    const key = foldTag(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  const key = foldTag(tag);
  return tags.filter((t) => foldTag(t) !== key);
}

export interface TagUsage {
  tag: string;
  count: number;
}

/** Tags in use across books: most frequent spelling per folded key, sorted by count then name. */
export function collectTags(books: readonly { tags: readonly string[] }[]): TagUsage[] {
  const groups = new Map<string, Map<string, number>>();
  for (const book of books) {
    for (const tag of book.tags) {
      const key = foldTag(tag);
      if (key === "") continue;
      const spellings = groups.get(key) ?? new Map<string, number>();
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1);
      groups.set(key, spellings);
    }
  }
  const usage: TagUsage[] = [];
  for (const spellings of groups.values()) {
    let best = "";
    let bestCount = -1;
    let total = 0;
    for (const [spelling, count] of spellings) {
      total += count;
      if (count > bestCount || (count === bestCount && spelling.localeCompare(best, "it") < 0)) {
        best = spelling;
        bestCount = count;
      }
    }
    usage.push({ tag: best, count: total });
  }
  return usage.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "it"));
}

/** Autocomplete: tags containing the query (prefix matches first), minus those already chosen. */
export function suggestTags(
  all: readonly TagUsage[],
  query: string,
  chosen: readonly string[],
  limit = 8,
): TagUsage[] {
  const q = foldTag(query);
  const taken = new Set(chosen.map(foldTag));
  const candidates = all.filter((u) => !taken.has(foldTag(u.tag)));
  if (q === "") return candidates.slice(0, limit);
  const starts: TagUsage[] = [];
  const contains: TagUsage[] = [];
  for (const u of candidates) {
    const key = foldTag(u.tag);
    if (key.startsWith(q)) starts.push(u);
    else if (key.includes(q)) contains.push(u);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Adds one item as typed (no splitting, for author names that may contain commas); skips folded duplicates. */
export function addItem(items: readonly string[], raw: string): string[] {
  const item = normalizeTag(raw);
  if (item === "") return [...items];
  const key = foldTag(item);
  return items.some((i) => foldTag(i) === key) ? [...items] : [...items, item];
}
