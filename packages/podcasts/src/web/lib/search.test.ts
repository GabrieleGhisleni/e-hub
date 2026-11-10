import { describe, expect, it } from "vitest";
import { makeEpisode, makeShow } from "@podcasts/testing/fixtures";
import { buildCatalog, groupByAddedMonth, toEpisode } from "./catalog";
import {
  EMPTY_FILTERS,
  filtersToParams,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  toggleValue,
  type Filters,
} from "./filters";
import { createEpisodeIndex, filterEpisodes } from "./search";

const shows = [
  makeShow({ slug: "alpha", name: "Alpha Show" }),
  makeShow({ slug: "beta", name: "Beta Pod" }),
];
const episodes = [
  makeEpisode({
    slug: "alpha-dopamine",
    title: "Controlling Your Dopamine",
    show: "alpha",
    guests: ["Anna Lembke"],
    tags: ["dopamine", "motivation"],
    summary: ["Pleasure and pain are balanced."],
    addedAt: "2026-03-01T10:00:00.000Z",
  }),
  makeEpisode({
    slug: "alpha-sleep",
    title: "Master Your Sleep",
    show: "alpha",
    tags: ["sleep", "light"],
    notes: "## Light\n\nMorning sunlight anchors the circadian clock.",
    addedAt: "2026-02-01T10:00:00.000Z",
  }),
  makeEpisode({
    slug: "beta-ai",
    title: "Scaling and Interpretability",
    show: "beta",
    guests: ["José Pérez"],
    tags: ["ai", "sleep"],
    summary: ["Models keep improving with compute."],
    addedAt: "2026-04-01T10:00:00.000Z",
  }),
  makeEpisode({
    slug: "beta-history",
    title: "The Fall of Rome",
    show: "beta",
    tags: ["history"],
    addedAt: "2026-01-15T10:00:00.000Z",
  }),
];

const catalog = buildCatalog(shows, episodes);
const index = createEpisodeIndex(catalog.episodes);
const run = (filters: Partial<Filters>) =>
  filterEpisodes(catalog, index, { ...EMPTY_FILTERS, ...filters });
const slugs = (filters: Partial<Filters>) => run(filters).episodes.map((episode) => episode.slug);

describe("catalog", () => {
  it("sorts episodes by addedAt, newest first, and shows by name", () => {
    expect(catalog.episodes.map((episode) => episode.slug)).toEqual([
      "beta-ai",
      "alpha-dopamine",
      "alpha-sleep",
      "beta-history",
    ]);
    expect(catalog.shows.map((show) => show.slug)).toEqual(["alpha", "beta"]);
  });

  it("fills defaults and skips records without the essentials", () => {
    const partial = toEpisode({
      slug: "x",
      title: "X",
      show: "alpha",
      url: "https://example.com/x",
      addedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(partial).toMatchObject({ guests: [], tags: [], summary: [], notes: "", extra: {} });
    expect(toEpisode({ slug: "x" })).toBeUndefined();
    expect(buildCatalog([], [{ nope: true }, null]).episodes).toEqual([]);
  });

  it("groups consecutive episodes by month", () => {
    const groups = groupByAddedMonth(catalog.episodes, (iso) => iso.slice(0, 7));
    expect(groups.map((group) => [group.key, group.episodes.length])).toEqual([
      ["2026-04", 1],
      ["2026-03", 1],
      ["2026-02", 1],
      ["2026-01", 1],
    ]);
  });
});

describe("search", () => {
  it("without a query lists everything by addedAt", () => {
    const result = run({});
    expect(result.searched).toBe(false);
    expect(result.episodes.map((episode) => episode.slug)).toEqual([
      "beta-ai",
      "alpha-dopamine",
      "alpha-sleep",
      "beta-history",
    ]);
  });

  it("searches title, guests, tags, summary and notes", () => {
    expect(slugs({ q: "rome" })).toEqual(["beta-history"]); // title
    expect(slugs({ q: "lembke" })).toEqual(["alpha-dopamine"]); // guests
    expect(slugs({ q: "motivation" })).toEqual(["alpha-dopamine"]); // tags
    expect(slugs({ q: "compute" })).toEqual(["beta-ai"]); // summary
    expect(slugs({ q: "circadian" })).toEqual(["alpha-sleep"]); // notes
  });

  it("supports prefix, fuzzy and diacritics-insensitive matching", () => {
    expect(slugs({ q: "interpret" })).toEqual(["beta-ai"]);
    expect(slugs({ q: "dopamne" })).toEqual(["alpha-dopamine"]);
    expect(slugs({ q: "perez" })).toEqual(["beta-ai"]);
    expect(slugs({ q: "PÉREZ" })).toEqual(["beta-ai"]);
  });

  it("requires every word to match", () => {
    expect(slugs({ q: "sleep light" })).toEqual(["alpha-sleep"]);
    expect(slugs({ q: "sleep rome" })).toEqual([]);
  });

  it("ranks by relevance when searching (title beats notes)", () => {
    const result = run({ q: "sleep" });
    expect(result.searched).toBe(true);
    expect(result.episodes.map((episode) => episode.slug)).toEqual(["alpha-sleep", "beta-ai"]);
  });

  it("ignores blank or punctuation-only queries", () => {
    expect(run({ q: "   " }).searched).toBe(false);
    expect(run({ q: " - " }).episodes).toHaveLength(4);
  });
});

describe("filters", () => {
  it("filters by show (any of) and tags (all of)", () => {
    expect(slugs({ shows: ["alpha"] })).toEqual(["alpha-dopamine", "alpha-sleep"]);
    expect(slugs({ shows: ["alpha", "beta"] })).toHaveLength(4);
    expect(slugs({ tags: ["sleep"] })).toEqual(["beta-ai", "alpha-sleep"]);
    expect(slugs({ tags: ["sleep", "light"] })).toEqual(["alpha-sleep"]);
    expect(slugs({ tags: ["sleep"], shows: ["beta"] })).toEqual(["beta-ai"]);
    expect(slugs({ q: "scaling", shows: ["alpha"] })).toEqual([]);
  });

  it("computes facet counts", () => {
    const result = run({ tags: ["sleep"], shows: ["alpha"] });
    // Show counts ignore the show filter (other shows stay pickable)…
    expect(Object.fromEntries(result.showCounts)).toEqual({ alpha: 1, beta: 1 });
    // …tag counts are over the current results.
    expect(Object.fromEntries(result.tagCounts)).toEqual({ sleep: 1, light: 1 });
  });

  it("round-trips through URL search params", () => {
    const filters: Filters = { q: "dopamine focus ", shows: ["alpha"], tags: ["ai", "sleep"] };
    const params = filtersToParams(filters);
    expect(params.toString()).toBe("q=dopamine+focus+&show=alpha&tag=ai&tag=sleep");
    expect(parseFilters(params)).toEqual(filters);
    expect(parseFilters(new URLSearchParams("tag=ai&tag=ai&tag=&show=%20"))).toEqual({
      q: "",
      shows: [],
      tags: ["ai"],
    });
    expect(filtersToSearch(EMPTY_FILTERS)).toBe("");
    expect(filtersToSearch({ ...EMPTY_FILTERS, q: "  " })).toBe("");
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: "  " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, tags: ["ai"] })).toBe(true);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleValue(["b"], "a")).toEqual(["b", "a"]);
  });
});
