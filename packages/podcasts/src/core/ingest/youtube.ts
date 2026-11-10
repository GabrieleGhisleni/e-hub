/**
 * YouTube metadata (DESIGN.md §6): oEmbed (title, channel name, channel URL),
 * the watch page (publication date; title/channel fallback when oEmbed is
 * refused) and the channel page (avatar for a new generic show).
 */
import { NotFoundError } from "../errors";
import { HttpError, type Http } from "./http";
import { canonicalYoutubeUrl } from "./recognize";
import { cleanText, decodeEntities, isoDatePart } from "./text";

export interface YoutubeVideoInfo {
  youtubeId: string;
  title: string;
  /** Channel display name (oEmbed `author_name`). */
  authorName: string;
  /** Channel URL (oEmbed `author_url`, e.g. `https://www.youtube.com/@lexfridman`). */
  authorUrl: string;
}

/** Parses an oEmbed JSON response; `undefined` if it lacks the needed fields. */
export function parseOembed(youtubeId: string, value: unknown): YoutubeVideoInfo | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const { title, author_name: authorName, author_url: authorUrl } = record;
  if (typeof title !== "string" || typeof authorUrl !== "string") return undefined;
  return {
    youtubeId,
    title: cleanText(title),
    authorName: cleanText(typeof authorName === "string" ? authorName : ""),
    authorUrl: httpsUrl(authorUrl),
  };
}

export interface YoutubeWatchPage {
  title?: string;
  authorName?: string;
  authorUrl?: string;
  /** `YYYY-MM-DD` as published (date in the page's own timezone). */
  publishedAt?: string;
}

function metaContent(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html);
  return match?.[1] === undefined ? undefined : cleanText(decodeEntities(match[1]));
}

function httpsUrl(url: string): string {
  return url.replace(/^http:\/\//, "https://");
}

/** Extracts title, channel and publication date from a watch page (regexes: the page is ~2 MB of scripts). */
export function parseWatchPage(html: string): YoutubeWatchPage {
  const date =
    metaContent(html, /itemprop="datePublished"\s+content="([^"]+)"/) ??
    metaContent(html, /itemprop="uploadDate"\s+content="([^"]+)"/) ??
    metaContent(html, /"uploadDate":"([^"]+)"/) ??
    metaContent(html, /"publishDate":"([^"]+)"/);
  const author = /<span itemprop="author"[^>]*>([\s\S]{0,600}?)<\/span>/.exec(html)?.[1] ?? "";
  const authorUrl = metaContent(author, /<link itemprop="url" href="([^"]+)"/);
  return {
    title:
      metaContent(html, /<meta name="title" content="([^"]*)"/) ??
      metaContent(html, /<meta property="og:title" content="([^"]*)"/),
    authorName: metaContent(author, /<link itemprop="name" content="([^"]*)"/),
    authorUrl: authorUrl ? httpsUrl(authorUrl) : undefined,
    publishedAt: isoDatePart(date),
  };
}

/** Channel avatar (`og:image`) from a channel page. */
export function parseChannelAvatar(html: string): string | undefined {
  const url = metaContent(html, /<meta property="og:image" content="([^"]+)"/);
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

export function oembedUrl(youtubeId: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalYoutubeUrl(youtubeId))}&format=json`;
}

/** Fetches the watch page; `undefined` (never throws) when it is unavailable or unparsable (e.g. consent wall). */
export async function fetchWatchPage(
  http: Http,
  youtubeId: string,
): Promise<YoutubeWatchPage | undefined> {
  try {
    return parseWatchPage(await http.text(canonicalYoutubeUrl(youtubeId)));
  } catch {
    return undefined;
  }
}

/**
 * Video title and channel via oEmbed. If oEmbed refuses the video (401/403:
 * embedding disabled) the watch page is used instead. 404/400 → `NotFoundError`
 * (private, deleted or nonexistent video).
 */
export async function fetchVideoInfo(http: Http, youtubeId: string): Promise<YoutubeVideoInfo> {
  try {
    const info = parseOembed(youtubeId, await http.json(oembedUrl(youtubeId)));
    if (info) return info;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.status === 404 || error.status === 400)
      throw new NotFoundError(`YouTube video '${youtubeId}' not found (private or deleted?)`);
    if (error.status !== 401 && error.status !== 403) throw error;
  }
  const page = await fetchWatchPage(http, youtubeId);
  if (!page?.title || !page.authorUrl)
    throw new NotFoundError(`cannot read metadata of YouTube video '${youtubeId}'`);
  return {
    youtubeId,
    title: page.title,
    authorName: page.authorName ?? "",
    authorUrl: page.authorUrl,
  };
}

/** Channel avatar URL, or `undefined` (never throws). */
export async function fetchChannelAvatar(
  http: Http,
  channelUrl: string,
): Promise<string | undefined> {
  try {
    return parseChannelAvatar(await http.text(channelUrl));
  } catch {
    return undefined;
  }
}

/** Removes a trailing " | <channel>" (or " - <channel>") from a video title, if something remains. */
export function stripChannelSuffix(title: string, channelNames: string[]): string {
  let result = cleanText(title);
  for (const name of channelNames.filter(Boolean)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = result.replace(new RegExp(`\\s+[|–—-]\\s+${escaped}\\s*$`, "i"), "");
    if (stripped.trim()) result = stripped.trim();
  }
  return result;
}
