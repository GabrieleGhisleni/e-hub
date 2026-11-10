/**
 * Fallback audio for `pnpm transcribe` (DESIGN.md §7.2): the episode's MP3
 * `<enclosure>` in the show's RSS feed, matched by episode number if known,
 * otherwise by normalised title + `publishedAt` (±3 days). Parsing and HTTP
 * come from ingest (`src/core/ingest/feed.ts`); only the matching lives here.
 */
import type { Episode, Show } from "../../core/schema";
import { fetchFeed, type FeedItem } from "../../core/ingest/feed";
import type { Http } from "../../core/ingest/http";
import { episodeNumberFromTitle, normalizeTitle } from "../../core/ingest/text";

export type FeedMatchKind = "number" | "title-date" | "title";

export interface FeedMatch {
  item: FeedItem & { enclosureUrl: string };
  matchedBy: FeedMatchKind;
}

export interface EpisodeQuery {
  number?: number;
  title: string;
  publishedAt?: string;
}

export const FEED_DATE_TOLERANCE_DAYS = 3;
/** Minimum overlap coefficient when the date narrows the candidates down to a few days. */
export const MIN_OVERLAP_WITH_DATE = 0.5;
/** Without a date the whole feed is searched: minimum Dice coefficient (near-identical titles). */
export const MIN_DICE_WITHOUT_DATE = 0.75;

const STOP_WORDS = new Set(["the", "and", "of", "a", "an", "to", "in", "on", "for", "with", "at"]);

function titleTokens(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((token) => token && !STOP_WORDS.has(token)),
  );
}

export type SimilarityKind = "overlap" | "dice";

/**
 * Similarity of the title words. `overlap` = |A∩B| / min(|A|,|B|): 1 when one
 * title contains the other, as when YouTube appends "| Show Name #123" (used
 * within the date window). `dice` = 2|A∩B| / (|A|+|B|): also penalises a short
 * title that is merely contained in a long one (used without a date).
 */
export function titleSimilarity(a: string, b: string, kind: SimilarityKind = "overlap"): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const token of x) if (y.has(token)) common++;
  return kind === "dice" ? (2 * common) / (x.size + y.size) : common / Math.min(x.size, y.size);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function itemNumber(item: FeedItem): number | undefined {
  return item.number ?? episodeNumberFromTitle(item.title);
}

function hasEnclosure(item: FeedItem): item is FeedItem & { enclosureUrl: string } {
  return typeof item.enclosureUrl === "string" && /^https?:\/\//.test(item.enclosureUrl);
}

/** The best unique candidate above `min`, or undefined (no match or a tie). */
function bestByTitle<T extends FeedItem>(
  candidates: T[],
  title: string,
  min: number,
  kind: SimilarityKind = "overlap",
): T | undefined {
  const scored = candidates
    .map((item) => ({ item, score: titleSimilarity(item.title, title, kind) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < min) return undefined;
  if (second && second.score === best.score) return undefined;
  return best.item;
}

/** Finds the feed item (with an audio enclosure) of an episode. */
export function matchFeedEnclosure(
  items: readonly FeedItem[],
  query: EpisodeQuery,
): FeedMatch | undefined {
  const withAudio = items.filter(hasEnclosure);
  if (query.number !== undefined) {
    const byNumber = withAudio.filter((item) => itemNumber(item) === query.number);
    if (byNumber.length > 0) {
      const item =
        byNumber.length === 1
          ? byNumber[0]!
          : (bestByTitle(byNumber, query.title, 0) ?? byNumber[0]!);
      return { item, matchedBy: "number" };
    }
  }
  if (query.publishedAt) {
    const near = withAudio.filter(
      (item) =>
        item.publishedAt !== undefined &&
        daysBetween(item.publishedAt, query.publishedAt!) <= FEED_DATE_TOLERANCE_DAYS,
    );
    const item = bestByTitle(near, query.title, MIN_OVERLAP_WITH_DATE);
    return item ? { item, matchedBy: "title-date" } : undefined;
  }
  const item = bestByTitle(withAudio, query.title, MIN_DICE_WITHOUT_DATE, "dice");
  return item ? { item, matchedBy: "title" } : undefined;
}

export interface FeedAudioResolution {
  match?: FeedMatch;
  /** Why there is no feed audio (no feed, fetch failed, no match); shown as a warning. */
  reason?: string;
}

/** Fetches the show's feed and matches the episode. Never throws: a failure only means "no fallback". */
export async function resolveFeedAudio(
  show: Show,
  episode: Episode,
  http: Http,
): Promise<FeedAudioResolution> {
  if (!show.feedUrl) return { reason: `show '${show.slug}' has no feedUrl` };
  let items: FeedItem[];
  try {
    items = (await fetchFeed(http, show.feedUrl)).items;
  } catch (error) {
    return { reason: `could not read the feed ${show.feedUrl}: ${(error as Error).message}` };
  }
  const match = matchFeedEnclosure(items, {
    number: episode.number,
    title: episode.title,
    publishedAt: episode.publishedAt,
  });
  return match
    ? { match }
    : { reason: `no item of ${show.feedUrl} (${items.length} items) matches this episode` };
}
