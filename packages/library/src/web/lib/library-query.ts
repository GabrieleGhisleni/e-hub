/**
 * Library query: search, filters and sort for the grid, plus their URL encoding.
 * Pure functions only (no React, no DOM), unit-tested in test/web. Relative imports on purpose,
 * so vitest resolves them without the Vite aliases.
 */
import { STATUS_LABELS } from "../../shared/labels.ts";
import type { BookCard, BookStatus } from "../../shared/schema.ts";
import { authorSurname } from "../../shared/slug.ts";
import { foldToAscii } from "../../shared/text.ts";

// ---------------------------------------------------------------------------------------------
// Query model
// ---------------------------------------------------------------------------------------------

export const SORT_KEYS = ["title", "author", "recent", "manual"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = "title";

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  title: "Titolo",
  author: "Autore",
  recent: "Letture recenti",
  manual: "Il mio ordine",
};

/** Statuses in display order (the enum order). Taken from the labels so zod never enters the bundle. */
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as BookStatus[];

export interface LibraryQuery {
  /** Free text, matched against title + authors (every word must match). */
  q: string;
  /** Single topic ID, or null for every topic. */
  topic: string | null;
  /** Selected tags (a book must have all of them). */
  tags: string[];
  /** Selected statuses (a book must have one of them). */
  statuses: BookStatus[];
  sort: SortKey;
}

export const EMPTY_QUERY: Readonly<LibraryQuery> = Object.freeze({
  q: "",
  topic: null,
  tags: [],
  statuses: [],
  sort: DEFAULT_SORT,
});

/** URL parameter names: `?q=…&topic=…&tag=…&tag=…&status=…&sort=…`. */
export const QUERY_PARAMS = {
  q: "q",
  topic: "topic",
  tag: "tag",
  status: "status",
  sort: "sort",
} as const;

function isStatus(value: string): value is BookStatus {
  return Object.hasOwn(STATUS_LABELS, value);
}

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

/** Reads the query from the URL. Invalid statuses/sorts are dropped, duplicates removed. */
export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const topic = params.get(QUERY_PARAMS.topic)?.trim() ?? "";
  const tags = uniqueBy(
    params
      .getAll(QUERY_PARAMS.tag)
      .map((t) => t.trim())
      .filter((t) => t !== ""),
    tagKey,
  );
  const wanted = new Set(params.getAll(QUERY_PARAMS.status).filter(isStatus));
  const sort = params.get(QUERY_PARAMS.sort) ?? "";
  return {
    q: params.get(QUERY_PARAMS.q) ?? "",
    topic: topic === "" ? null : topic,
    tags,
    statuses: STATUS_ORDER.filter((s) => wanted.has(s)),
    sort: isSortKey(sort) ? sort : DEFAULT_SORT,
  };
}

/** Canonical URL form of the query: empty values and the default sort are omitted. */
export function serializeLibraryQuery(query: LibraryQuery): URLSearchParams {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q !== "") params.set(QUERY_PARAMS.q, q);
  if (query.topic) params.set(QUERY_PARAMS.topic, query.topic);
  for (const tag of uniqueBy(query.tags, tagKey)) params.append(QUERY_PARAMS.tag, tag);
  const statuses = new Set(query.statuses);
  for (const status of STATUS_ORDER) {
    if (statuses.has(status)) params.append(QUERY_PARAMS.status, status);
  }
  if (query.sort !== DEFAULT_SORT) params.set(QUERY_PARAMS.sort, query.sort);
  return params;
}

/** `?…` string for links ("" when the query is empty). */
export function libraryQueryString(query: LibraryQuery): string {
  const s = serializeLibraryQuery(query).toString();
  return s === "" ? "" : `?${s}`;
}

/** True when search or any filter narrows the list (the sort is not a filter). */
export function hasActiveFilters(query: LibraryQuery): boolean {
  return (
    query.q.trim() !== "" ||
    query.topic !== null ||
    query.tags.length > 0 ||
    query.statuses.length > 0
  );
}

/** Number of facet filters set (search excluded): the badge on the mobile "Filtri" button. */
export function activeFilterCount(query: LibraryQuery): number {
  return (query.topic === null ? 0 : 1) + query.tags.length + query.statuses.length;
}

/** Same query with search and filters cleared; the sort is kept. */
export function clearFilters(query: LibraryQuery): LibraryQuery {
  return { ...EMPTY_QUERY, sort: query.sort };
}

export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Adds or removes a tag (compared case- and accent-insensitively). */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  const key = tagKey(tag);
  return tags.some((t) => tagKey(t) === key)
    ? tags.filter((t) => tagKey(t) !== key)
    : [...tags, tag];
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

/**
 * Search normalization: diacritics stripped (NFD/NFKD + combining marks removed, ß → ss, …), lowercase,
 * every run of non-letters/digits becomes one space ("Moby-Dick" → "moby dick", "d’Ippona" → "d ippona").
 */
export function normalizeText(input: string): string {
  return foldToAscii(input.normalize("NFD"))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Query words, normalized; empty when the query is blank. */
export function searchTokens(q: string): string[] {
  const normalized = normalizeText(q);
  return normalized === "" ? [] : normalized.split(" ");
}

const haystacks = new WeakMap<BookCard, string>();

function haystack(book: BookCard): string {
  let text = haystacks.get(book);
  if (text === undefined) {
    text = ` ${normalizeText([book.title, ...book.authors].join(" "))} `;
    haystacks.set(book, text);
  }
  return text;
}

/** Every token must occur in title or authors (substring match, so prefixes work while typing). */
export function matchesSearch(book: BookCard, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const text = haystack(book);
  return tokens.every((token) => text.includes(token));
}

// ---------------------------------------------------------------------------------------------
// Filters and facets
// ---------------------------------------------------------------------------------------------

/** Tags are compared folded ("Classici" = "classici"). */
export function tagKey(tag: string): string {
  return normalizeText(tag);
}

type Facet = "topic" | "tags" | "statuses";

interface Matcher {
  tokens: string[];
  topic: string | null;
  tagKeys: string[];
  statuses: ReadonlySet<BookStatus>;
}

function matcher(query: LibraryQuery): Matcher {
  return {
    tokens: searchTokens(query.q),
    topic: query.topic,
    tagKeys: uniqueBy(query.tags.map(tagKey), (k) => k),
    statuses: new Set(query.statuses),
  };
}

function matches(book: BookCard, m: Matcher, skip?: Facet): boolean {
  if (skip !== "topic" && m.topic !== null && book.topic !== m.topic) return false;
  if (skip !== "statuses") {
    if (m.statuses.size > 0 && !m.statuses.has(book.status)) return false;
  }
  if (skip !== "tags" && m.tagKeys.length > 0) {
    const keys = new Set(book.tags.map(tagKey));
    if (!m.tagKeys.every((k) => keys.has(k))) return false;
  }
  return matchesSearch(book, m.tokens);
}

/** Books matching search + filters, in their original order. */
export function filterBooks(books: readonly BookCard[], query: LibraryQuery): BookCard[] {
  const m = matcher(query);
  return books.filter((book) => matches(book, m));
}

export interface TagFacet {
  /** Folded key used for matching. */
  key: string;
  /** Display form: the most frequent spelling in the library. */
  label: string;
  /** Books in the current result that have this tag (= the result size if it were added). */
  count: number;
  selected: boolean;
}

export interface Facets {
  /** Per topic ID: books matching every filter except the topic. */
  topics: Map<string, number>;
  /** Books matching every filter except the topic (the "Tutti" count). */
  topicTotal: number;
  /** Per status: books matching every filter except the status. */
  statuses: Map<BookStatus, number>;
  /** Tags of the current result, plus the selected ones, sorted alphabetically. */
  tags: TagFacet[];
}

const collator = new Intl.Collator("it", { sensitivity: "base", numeric: true });

/** Most frequent spelling of every tag key in the whole library. */
export function tagLabels(books: readonly BookCard[]): Map<string, string> {
  const spellings = new Map<string, Map<string, number>>();
  for (const book of books) {
    for (const tag of book.tags) {
      const key = tagKey(tag);
      if (key === "") continue;
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      spellings.set(key, counts);
    }
  }
  const labels = new Map<string, string>();
  for (const [key, counts] of spellings) {
    const best = [...counts].toSorted((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0];
    if (best) labels.set(key, best[0]);
  }
  return labels;
}

/** Counts for the filter panel ("faceted search"). */
export function computeFacets(books: readonly BookCard[], query: LibraryQuery): Facets {
  const m = matcher(query);
  const topics = new Map<string, number>();
  const statuses = new Map<BookStatus, number>();
  const tagCounts = new Map<string, number>();
  let topicTotal = 0;
  for (const book of books) {
    if (matches(book, m, "topic")) {
      topicTotal += 1;
      topics.set(book.topic, (topics.get(book.topic) ?? 0) + 1);
    }
    if (matches(book, m, "statuses")) {
      statuses.set(book.status, (statuses.get(book.status) ?? 0) + 1);
    }
    if (matches(book, m)) {
      for (const key of new Set(book.tags.map(tagKey))) {
        if (key !== "") tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const labels = tagLabels(books);
  const selected = new Set(m.tagKeys);
  for (const tag of query.tags) {
    const key = tagKey(tag);
    if (!labels.has(key)) labels.set(key, tag);
    if (!tagCounts.has(key)) tagCounts.set(key, 0);
  }
  const tags = [...tagCounts]
    .map(([key, count]) => ({
      key,
      label: labels.get(key) ?? key,
      count,
      selected: selected.has(key),
    }))
    .toSorted((a, b) => collator.compare(a.label, b.label));
  return { topics, topicTotal, statuses, tags };
}

// ---------------------------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------------------------

function byTitle(a: BookCard, b: BookCard): number {
  return collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byAuthor(a: BookCard, b: BookCard): number {
  const first = (book: BookCard) => book.authors[0] ?? "";
  return (
    collator.compare(authorSurname(first(a)), authorSurname(first(b))) ||
    collator.compare(first(a), first(b)) ||
    byTitle(a, b)
  );
}

/** Last reading activity: the end date, else the start date. */
function activityDate(book: BookCard): string | undefined {
  return book.finishedAt ?? book.startedAt;
}

function byRecent(a: BookCard, b: BookCard): number {
  const da = activityDate(a);
  const db = activityDate(b);
  if (da !== db) {
    if (da === undefined) return 1;
    if (db === undefined) return -1;
    return da < db ? 1 : -1;
  }
  return byTitle(a, b);
}

const COMPARATORS: Readonly<Record<Exclude<SortKey, "manual">, (a: BookCard, b: BookCard) => number>> = {
  title: byTitle,
  author: byAuthor,
  recent: byRecent,
};

/**
 * New sorted array: title (Italian collation), author surname, most recent reading activity first, or the user's own
 * order (`order`: ids; books not in it come after, by title).
 */
export function sortBooks(books: readonly BookCard[], sort: SortKey, order: readonly string[] = []): BookCard[] {
  if (sort !== "manual") return books.toSorted(COMPARATORS[sort]);
  const rank = new Map(order.map((id, i) => [id, i]));
  return books.toSorted((a, b) => {
    const ra = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    return ra === rb ? byTitle(a, b) : ra < rb ? -1 : 1;
  });
}

/** Filter + sort in one go. */
export function applyLibraryQuery(
  books: readonly BookCard[],
  query: LibraryQuery,
  order: readonly string[] = [],
): BookCard[] {
  return sortBooks(filterBooks(books, query), query.sort, order);
}
