/**
 * Full-text search (MiniSearch, in memory) and show/tag filtering for the
 * home list (DESIGN.md §8.3). The index covers title, guests, tags, summary
 * and notes; it is built once when the app loads (< 100 episodes).
 */
import MiniSearch, { type SearchOptions } from "minisearch";
import type { Episode } from "@core/schema";
import type { Catalog } from "./catalog";
import type { Filters } from "./filters";

export const SEARCH_FIELDS = ["title", "guests", "tags", "summary", "notes"] as const;
type SearchField = (typeof SEARCH_FIELDS)[number];

export type EpisodeIndex = MiniSearch<Episode>;

/** Lowercase, without diacritics ("Pérez" matches "perez"). */
export function normalizeTerm(term: string): string {
  return term
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

export const SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  fuzzy: 0.2,
  // Every word must match (somewhere): typing more words narrows the list.
  combineWith: "AND",
  boost: { title: 3, guests: 3, tags: 2, summary: 1.5 },
};

export function createEpisodeIndex(episodes: readonly Episode[]): EpisodeIndex {
  const index = new MiniSearch<Episode>({
    idField: "slug",
    fields: [...SEARCH_FIELDS],
    extractField: (episode, field) => {
      const value = episode[field as SearchField];
      return Array.isArray(value) ? value.join("\n") : (value ?? "");
    },
    processTerm: (term) => normalizeTerm(term) || null,
    searchOptions: SEARCH_OPTIONS,
  });
  index.addAll(episodes);
  return index;
}

export interface FilterResult {
  /** Matching episodes: by relevance when there is a query, otherwise newest `addedAt` first. */
  readonly episodes: readonly Episode[];
  /** Whether a (non-blank) query was applied. */
  readonly searched: boolean;
  /** Per show: matches of the query + tag filters (the show filter itself is ignored, so other shows stay pickable). */
  readonly showCounts: ReadonlyMap<string, number>;
  /** Per tag: how many of the current results have it (tags combine with AND). */
  readonly tagCounts: ReadonlyMap<string, number>;
}

function hasSearchableText(query: string): boolean {
  return /[\p{L}\p{N}]/u.test(query);
}

function countBy(episodes: readonly Episode[], keys: (episode: Episode) => readonly string[]) {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    for (const key of keys(episode)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function filterEpisodes(
  catalog: Catalog,
  index: EpisodeIndex,
  filters: Filters,
): FilterResult {
  const query = filters.q.trim();
  const searched = hasSearchableText(query);
  const matched: Episode[] = searched
    ? index
        .search(query)
        .map((hit) => catalog.episodesBySlug.get(String(hit.id)))
        .filter((episode): episode is Episode => episode !== undefined)
    : [...catalog.episodes];

  const withFacets = matched.filter((episode) =>
    (!filters.month || episode.publishedAt?.slice(0, 7) === filters.month) &&
    filters.tags.every((tag) => episode.tags.includes(tag)),
  );
  const inShows = (episode: Episode) =>
    filters.shows.length === 0 || filters.shows.includes(episode.show);

  const episodes = withFacets.filter(inShows);
  return {
    episodes,
    searched,
    showCounts: countBy(withFacets, (episode) => [episode.show]),
    tagCounts: countBy(episodes, (episode) => episode.tags),
  };
}
