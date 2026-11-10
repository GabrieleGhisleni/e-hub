/**
 * URL helpers for duplicate detection (DESIGN.md §13) and ingest. Pure and isomorphic.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the video id from YouTube URLs: `watch?v=`, `youtu.be/<id>`,
 * `/embed/`, `/shorts/`, `/live/`, `/v/`. Returns `undefined` for anything else.
 */
export function extractYoutubeId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  let candidate: string | undefined;
  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = parsed.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = parsed.pathname.split("/").slice(1);
    if (first === "watch") candidate = parsed.searchParams.get("v") ?? undefined;
    else if (first && ["embed", "shorts", "live", "v"].includes(first)) candidate = second;
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : undefined;
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|si|feature|pp)$/i;

/**
 * Canonical form of a URL for equality checks: https, lowercase host without
 * `www.`/`m.`, no fragment, no tracking parameters, sorted query, no trailing
 * slash. Returns the input trimmed if it is not a valid URL.
 */
export function normalizeUrlForComparison(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const port = parsed.port ? `:${parsed.port}` : "";
  return `https://${host}${port}${pathname}${query}`;
}

export interface EpisodeMatch<E> {
  episode: E;
  matchedBy: "youtubeId" | "url";
}

/**
 * Finds the episode that a new URL / YouTube id would duplicate (DESIGN.md
 * §13): same `youtubeId` (also extracted from either URL), or same URL after
 * `normalizeUrlForComparison`. Pure version of `findEpisodeByUrlOrYoutubeId`.
 */
export function findMatchingEpisode<E extends { url: string; youtubeId?: string | undefined }>(
  episodes: readonly E[],
  query: { url?: string | undefined; youtubeId?: string | undefined },
): EpisodeMatch<E> | undefined {
  const ids = new Set(
    [query.youtubeId, query.url ? extractYoutubeId(query.url) : undefined].filter(Boolean),
  );
  if (ids.size > 0) {
    const episode = episodes.find(
      (candidate) =>
        (candidate.youtubeId && ids.has(candidate.youtubeId)) ||
        ids.has(extractYoutubeId(candidate.url)),
    );
    if (episode) return { episode, matchedBy: "youtubeId" };
  }
  if (query.url) {
    const url = normalizeUrlForComparison(query.url);
    const episode = episodes.find((candidate) => normalizeUrlForComparison(candidate.url) === url);
    if (episode) return { episode, matchedBy: "url" };
  }
  return undefined;
}
