/**
 * Podcast RSS feeds: channel cover (show image, DESIGN.md §4.1) and items
 * (title, link, official episode number, date) used to enrich Huberman
 * episodes and to resolve hubermanlab.com URLs without fetching that site.
 */
import { XMLParser } from "fast-xml-parser";
import { normalizeUrlForComparison } from "../urls";
import type { Http } from "./http";
import { cleanText, normalizeTitle, rfc822ToIsoDate, titlesMatch } from "./text";

export interface FeedItem {
  title: string;
  link?: string;
  /** `itunes:episode`, when the feed numbers its episodes. */
  number?: number;
  /** `YYYY-MM-DD` (UTC) of `pubDate`. */
  publishedAt?: string;
  enclosureUrl?: string;
}

export interface ParsedFeed {
  title?: string;
  author?: string;
  /** Channel-level `<itunes:image href>` (or `<image><url>`). */
  coverUrl?: string;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  htmlEntities: true,
  isArray: (name) => name === "item",
});

function text(value: unknown): string | undefined {
  if (typeof value === "string") return cleanText(value) || undefined;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value)
    return text((value as { "#text": unknown })["#text"]);
  return undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function attr(value: unknown, name: string): string | undefined {
  const node = first(value);
  if (!node || typeof node !== "object") return undefined;
  const result = (node as Record<string, unknown>)[`@_${name}`];
  return typeof result === "string" ? result.trim() || undefined : undefined;
}

/** Parses an RSS 2.0 podcast feed. Returns `undefined` if it is not RSS. */
export function parseFeed(xml: string): ParsedFeed | undefined {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return undefined;
  }
  const channel = (doc as { rss?: { channel?: unknown } } | undefined)?.rss?.channel;
  if (!channel || typeof channel !== "object") return undefined;
  const record = channel as Record<string, unknown>;
  const imageNode = first(record.image);
  const coverUrl =
    attr(record["itunes:image"], "href") ??
    (imageNode && typeof imageNode === "object"
      ? text((imageNode as Record<string, unknown>).url)
      : undefined);
  const items = (Array.isArray(record.item) ? record.item : []).flatMap((raw): FeedItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const title = text(first(item.title));
    if (!title) return [];
    const number = Number(text(first(item["itunes:episode"])));
    return [
      {
        title,
        link: text(first(item.link)),
        number: Number.isInteger(number) && number > 0 ? number : undefined,
        publishedAt: rfc822ToIsoDate(text(first(item.pubDate))),
        enclosureUrl: attr(item.enclosure, "url"),
      },
    ];
  });
  return {
    title: text(first(record.title)),
    author: text(first(record["itunes:author"])),
    coverUrl: coverUrl && /^https?:\/\//.test(coverUrl) ? coverUrl : undefined,
    items,
  };
}

/** Feeds can be several MB (Huberman ~4.5 MB). */
const FEED_TIMEOUT_MS = 60_000;

/** Fetches and parses a feed; throws `HttpError` on network errors and `Error` if it is not RSS. */
export async function fetchFeed(http: Http, feedUrl: string): Promise<ParsedFeed> {
  const feed = parseFeed(await http.text(feedUrl, { timeoutMs: FEED_TIMEOUT_MS }));
  if (!feed) throw new Error(`not an RSS feed: ${feedUrl}`);
  return feed;
}

/** Channel cover URL of a feed (`<itunes:image href>`); throws if there is none. */
export async function fetchFeedCover(http: Http, feedUrl: string): Promise<string> {
  const { coverUrl } = await fetchFeed(http, feedUrl);
  if (!coverUrl) throw new Error(`feed ${feedUrl}: no channel <itunes:image>`);
  return coverUrl;
}

/** The feed item with the same `<link>` (normalised), else the same title (see `titlesMatch`). */
export function findFeedItem(
  items: readonly FeedItem[],
  query: { link?: string; title?: string },
): FeedItem | undefined {
  if (query.link) {
    const link = normalizeUrlForComparison(query.link).toLowerCase();
    const byLink = items.find(
      (item) => item.link && normalizeUrlForComparison(item.link).toLowerCase() === link,
    );
    if (byLink) return byLink;
  }
  if (query.title) {
    const title = normalizeTitle(query.title);
    return (
      items.find((item) => normalizeTitle(item.title) === title) ??
      singleOrUndefined(items.filter((item) => titlesMatch(item.title, query.title!)))
    );
  }
  return undefined;
}

function singleOrUndefined<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}
