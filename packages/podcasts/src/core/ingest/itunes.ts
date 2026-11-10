/**
 * Podcast feed candidates for a new show via the iTunes Search API (free, no
 * key; DESIGN.md §4.1). The YouTube channel ↔ podcast match is uncertain, so
 * candidates are only *proposed*: the user confirms one (or none).
 */
import type { Http } from "./http";
import { normalizeTitle } from "./text";

export interface FeedCandidate {
  feedUrl: string;
  /** Podcast name (`collectionName`). */
  title: string;
  /** Publisher (`artistName`). */
  author: string;
  /** 600 px cover, when iTunes has one. */
  artworkUrl?: string;
  episodeCount?: number;
  /** Apple Podcasts page. */
  itunesUrl?: string;
  /** How well the podcast name/author matches the channel name. */
  match: "exact" | "partial" | "weak";
}

const MATCH_RANK = { exact: 0, partial: 1, weak: 2 } as const;
export const MAX_FEED_CANDIDATES = 5;

export function itunesSearchUrl(term: string): string {
  const params = new URLSearchParams({ term, media: "podcast", entity: "podcast", limit: "10" });
  return `https://itunes.apple.com/search?${params.toString()}`;
}

function matchQuality(names: string[], wanted: string[]): FeedCandidate["match"] {
  const a = names.map(normalizeTitle).filter(Boolean);
  const b = wanted.map(normalizeTitle).filter(Boolean);
  if (a.some((name) => b.includes(name))) return "exact";
  if (a.some((name) => b.some((w) => name.includes(w) || w.includes(name)))) return "partial";
  return "weak";
}

/**
 * Turns an iTunes Search response into candidates: only results with a feed,
 * best matches first (exact name/author match, then partial), at most
 * `MAX_FEED_CANDIDATES`, deduped by feed URL.
 */
export function parseItunesResults(value: unknown, wantedNames: string[]): FeedCandidate[] {
  const results = (value as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  const candidates: FeedCandidate[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as Record<string, unknown>;
    const feedUrl = typeof result.feedUrl === "string" ? result.feedUrl.trim() : "";
    if (!/^https?:\/\//.test(feedUrl) || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    const title = String(result.collectionName ?? result.trackName ?? "").trim();
    const author = String(result.artistName ?? "").trim();
    const count = Number(result.trackCount);
    candidates.push({
      feedUrl,
      title,
      author,
      artworkUrl: typeof result.artworkUrl600 === "string" ? result.artworkUrl600 : undefined,
      episodeCount: Number.isInteger(count) && count > 0 ? count : undefined,
      itunesUrl:
        typeof result.collectionViewUrl === "string"
          ? result.collectionViewUrl.replace(/\?.*$/, "")
          : undefined,
      match: matchQuality([title, author], wantedNames),
    });
  }
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (x, y) => MATCH_RANK[x.candidate.match] - MATCH_RANK[y.candidate.match] || x.index - y.index,
    )
    .map(({ candidate }) => candidate)
    .slice(0, MAX_FEED_CANDIDATES);
}

/** Searches iTunes for `term`; candidates ranked against `wantedNames` (channel name…). */
export async function searchFeedCandidates(
  http: Http,
  term: string,
  wantedNames: string[] = [term],
): Promise<FeedCandidate[]> {
  return parseItunesResults(await http.json(itunesSearchUrl(term)), wantedNames);
}
