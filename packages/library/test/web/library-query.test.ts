import { describe, expect, it } from "vitest";
import type { BookCard } from "../../src/shared/schema.ts";
import {
  EMPTY_QUERY,
  type LibraryQuery,
  activeFilterCount,
  applyLibraryQuery,
  clearFilters,
  computeFacets,
  filterBooks,
  hasActiveFilters,
  libraryQueryString,
  matchesSearch,
  normalizeText,
  parseLibraryQuery,
  searchTokens,
  serializeLibraryQuery,
  sortBooks,
  tagLabels,
  toggleTag,
  toggleValue,
} from "../../src/web/lib/library-query.ts";

let n = 0;
function card(partial: Partial<BookCard> & Pick<BookCard, "title" | "authors">): BookCard {
  n += 1;
  return {
    id: `b${String(n).padStart(7, "0")}`,
    slug: "x",
    topic: "narrativa",
    status: "to-read",
    tags: [],
    coverUrl: null,
    ...partial,
  };
}

const promessi = card({
  title: "I promessi sposi",
  authors: ["Alessandro Manzoni"],
  tags: ["Classici", "Ottocento"],
  status: "read",
  finishedAt: "2024-05-01",
});
const delitto = card({
  title: "Delitto e castigo",
  authors: ["Fëdor Dostoevskij"],
  tags: ["classici", "russi"],
  status: "reading",
  startedAt: "2025-01-10",
});
const principe = card({
  title: "Il Principe",
  authors: ["Niccolò Machiavelli"],
  topic: "filosofia",
  tags: ["politica"],
  status: "read",
  finishedAt: "2025-02-01",
});
const moby = card({
  title: "Moby-Dick",
  authors: ["Herman Melville"],
  tags: ["Classici", "mare"],
  status: "abandoned",
});
const confessioni = card({
  title: "Confessioni",
  authors: ["Agostino d’Ippona"],
  topic: "filosofia",
});
const books = [promessi, delitto, principe, moby, confessioni];

function q(partial: Partial<LibraryQuery>): LibraryQuery {
  return { ...EMPTY_QUERY, ...partial };
}

describe("normalizeText / searchTokens", () => {
  it("folds case and diacritics", () => {
    expect(normalizeText("Fëdor DOSTOEVSKIJ")).toBe("fedor dostoevskij");
    expect(normalizeText("Niccolò Città Perché")).toBe("niccolo citta perche");
    expect(normalizeText("Straße")).toBe("strasse");
  });
  it("turns punctuation into word breaks", () => {
    expect(normalizeText("Moby-Dick")).toBe("moby dick");
    expect(normalizeText("Agostino d’Ippona")).toBe("agostino d ippona");
    expect(normalizeText("  L'isola   del tesoro  ")).toBe("l isola del tesoro");
  });
  it("splits the query into words", () => {
    expect(searchTokens("  Dostoevskij   delitto ")).toEqual(["dostoevskij", "delitto"]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("—")).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("matches title and authors, accent- and case-insensitively", () => {
    expect(matchesSearch(delitto, searchTokens("fedor"))).toBe(true);
    expect(matchesSearch(delitto, searchTokens("FËDOR"))).toBe(true);
    expect(matchesSearch(principe, searchTokens("niccolo"))).toBe(true);
    expect(matchesSearch(principe, searchTokens("principe"))).toBe(true);
  });
  it("requires every word (AND), in any order, prefixes allowed", () => {
    expect(matchesSearch(principe, searchTokens("machiavelli principe"))).toBe(true);
    expect(matchesSearch(principe, searchTokens("princ machia"))).toBe(true);
    expect(matchesSearch(principe, searchTokens("machiavelli sposi"))).toBe(false);
  });
  it("handles punctuation in both query and data", () => {
    expect(matchesSearch(moby, searchTokens("moby dick"))).toBe(true);
    expect(matchesSearch(moby, searchTokens("moby-dick"))).toBe(true);
    expect(matchesSearch(confessioni, searchTokens("d'ippona"))).toBe(true);
  });
  it("does not search tags", () => {
    expect(matchesSearch(moby, searchTokens("mare"))).toBe(false);
  });
  it("matches everything with an empty query", () => {
    expect(filterBooks(books, q({ q: "  " }))).toHaveLength(books.length);
  });
});

describe("filterBooks", () => {
  it("filters by topic", () => {
    expect(filterBooks(books, q({ topic: "filosofia" }))).toEqual([principe, confessioni]);
  });
  it("filters by statuses (any of)", () => {
    expect(filterBooks(books, q({ statuses: ["reading", "abandoned"] }))).toEqual([delitto, moby]);
  });
  it("filters by tags (all of, case-insensitive)", () => {
    expect(filterBooks(books, q({ tags: ["classici"] }))).toEqual([promessi, delitto, moby]);
    expect(filterBooks(books, q({ tags: ["CLASSICI", "russi"] }))).toEqual([delitto]);
    expect(filterBooks(books, q({ tags: ["classici", "politica"] }))).toEqual([]);
  });
  it("combines search and filters", () => {
    expect(filterBooks(books, q({ q: "il", topic: "filosofia" }))).toEqual([principe]);
    expect(filterBooks(books, q({ q: "manzoni", statuses: ["reading"] }))).toEqual([]);
  });
});

describe("sortBooks", () => {
  it("sorts by title with Italian collation", () => {
    const sorted = sortBooks(books, "title").map((b) => b.title);
    expect(sorted).toEqual([
      "Confessioni",
      "Delitto e castigo",
      "I promessi sposi",
      "Il Principe",
      "Moby-Dick",
    ]);
  });
  it("sorts by author surname", () => {
    const sorted = sortBooks(books, "author").map((b) => b.authors[0]);
    expect(sorted).toEqual([
      "Agostino d’Ippona",
      "Fëdor Dostoevskij",
      "Niccolò Machiavelli",
      "Alessandro Manzoni",
      "Herman Melville",
    ]);
  });
  it("sorts by most recent reading activity, undated books last by title", () => {
    const sorted = sortBooks(books, "recent").map((b) => b.title);
    expect(sorted).toEqual([
      "Il Principe",
      "Delitto e castigo",
      "I promessi sposi",
      "Confessioni",
      "Moby-Dick",
    ]);
  });
  it("does not mutate the input", () => {
    const copy = [...books];
    sortBooks(books, "author");
    expect(books).toEqual(copy);
  });
  it("applyLibraryQuery filters then sorts", () => {
    expect(applyLibraryQuery(books, q({ tags: ["classici"], sort: "author" }))).toEqual([
      delitto,
      promessi,
      moby,
    ]);
  });
});

describe("URL state", () => {
  it("parses every parameter", () => {
    const params = new URLSearchParams(
      "q=manzoni&topic=narrativa&tag=classici&tag=russi&status=read&status=reading&sort=author",
    );
    expect(parseLibraryQuery(params)).toEqual({
      q: "manzoni",
      topic: "narrativa",
      tags: ["classici", "russi"],
      statuses: ["reading", "read"],
      sort: "author",
    });
  });
  it("drops invalid values and duplicates", () => {
    const params = new URLSearchParams(
      "topic=%20&tag=&tag=Classici&tag=classici&status=nope&status=read&status=read&sort=price",
    );
    expect(parseLibraryQuery(params)).toEqual({
      q: "",
      topic: null,
      tags: ["Classici"],
      statuses: ["read"],
      sort: "title",
    });
  });
  it("parses an empty URL to the empty query", () => {
    expect(parseLibraryQuery(new URLSearchParams())).toEqual(EMPTY_QUERY);
  });
  it("serializes canonically (defaults omitted, statuses in enum order, q trimmed)", () => {
    const params = serializeLibraryQuery(
      { ...EMPTY_QUERY, q: "  dante ", tags: ["poesia"], statuses: ["read", "to-read"], sort: "title" },
    );
    expect(params.toString()).toBe("q=dante&tag=poesia&status=to-read&status=read");
    expect(libraryQueryString(EMPTY_QUERY)).toBe("");
    expect(libraryQueryString({ ...EMPTY_QUERY, sort: "recent" })).toBe("?sort=recent");
  });
  it("round-trips", () => {
    const query = q({
      q: "città di dio",
      topic: "filosofia",
      tags: ["tardo antico", "Padri"],
      statuses: ["reading"],
      sort: "recent",
    });
    expect(parseLibraryQuery(serializeLibraryQuery(query))).toEqual(query);
  });
});

describe("read books and manual order", () => {
  it("shows the read books by default, and a status filter narrows them", () => {
    const all = [promessi, delitto, principe, moby, confessioni];
    const read = all.filter((b) => b.status === "read");
    expect(read.length).toBeGreaterThan(0);
    expect(filterBooks(all, EMPTY_QUERY)).toHaveLength(all.length);
    expect(filterBooks(all, { ...EMPTY_QUERY, statuses: ["read"] })).toHaveLength(read.length);
  });
  it("sorts by the manual order, unknown books after by title", () => {
    const all = [promessi, delitto, principe, moby, confessioni];
    const order = [confessioni.id, moby.id];
    const sorted = sortBooks(all, "manual", order).map((b) => b.id);
    expect(sorted.slice(0, 2)).toEqual(order);
    expect(sorted).toHaveLength(all.length);
  });
});

describe("query helpers", () => {
  it("knows when filters are active", () => {
    expect(hasActiveFilters(EMPTY_QUERY)).toBe(false);
    expect(hasActiveFilters(q({ sort: "author" }))).toBe(false);
    expect(hasActiveFilters(q({ q: " " }))).toBe(false);
    expect(hasActiveFilters(q({ q: "x" }))).toBe(true);
    expect(hasActiveFilters(q({ statuses: ["read"] }))).toBe(true);
  });
  it("counts facet filters (search excluded)", () => {
    expect(activeFilterCount(q({ q: "x", topic: "a", tags: ["b", "c"], statuses: ["read"] }))).toBe(
      4,
    );
  });
  it("clears filters but keeps the sort", () => {
    expect(clearFilters(q({ q: "x", topic: "a", sort: "author" }))).toEqual({ ...EMPTY_QUERY, sort: "author" });
  });
  it("toggles values and tags", () => {
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTag(["Classici"], "classici")).toEqual([]);
    expect(toggleTag(["Classici"], "russi")).toEqual(["Classici", "russi"]);
  });
});

describe("facets", () => {
  it("uses the most frequent spelling as tag label", () => {
    expect(tagLabels(books).get("classici")).toBe("Classici");
  });
  it("counts each facet ignoring its own filter", () => {
    const facets = computeFacets(books, q({ topic: "narrativa", statuses: ["read"] }));
    // Topics: status filter only (2 read books, one per topic).
    expect(facets.topicTotal).toBe(2);
    expect(facets.topics.get("narrativa")).toBe(1);
    expect(facets.topics.get("filosofia")).toBe(1);
    // Statuses: topic filter only (3 narrativa books).
    expect(facets.statuses.get("read")).toBe(1);
    expect(facets.statuses.get("reading")).toBe(1);
    expect(facets.statuses.get("abandoned")).toBe(1);
    expect(facets.statuses.get("to-read")).toBeUndefined();
    // Tags: every filter (only "I promessi sposi").
    expect(facets.tags).toEqual([
      { key: "classici", label: "Classici", count: 1, selected: false },
      { key: "ottocento", label: "Ottocento", count: 1, selected: false },
    ]);
  });
  it("keeps selected tags visible even with no result", () => {
    const facets = computeFacets(books, q({ q: "zzz", tags: ["Russi"] }));
    expect(facets.tags).toEqual([{ key: "russi", label: "russi", count: 0, selected: true }]);
  });
  it("keeps an unknown selected tag with its URL spelling", () => {
    const facets = computeFacets(books, q({ tags: ["Inesistente"] }));
    expect(facets.tags).toEqual([
      { key: "inesistente", label: "Inesistente", count: 0, selected: true },
    ]);
  });
});
