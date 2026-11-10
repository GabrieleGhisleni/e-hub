/**
 * Lex Fridman (DESIGN.md §6, §6.1): episode page metadata, the official
 * transcript page (WordPress HTML → unified transcript, `lex-official`,
 * timebase `youtube`) and the `youtubeId` → transcript page map built from
 * the "transcripts" category index, cached in `data/cache/`.
 */
import { load, type CheerioAPI } from "cheerio";
import { z } from "zod";
import type { TranscriptInput } from "../schema";
import { extractYoutubeId } from "../urls";
import { readCache, writeCache } from "./cache";
import type { Http } from "./http";
import { lexEpisodeUrl, recognizeUrl } from "./recognize";
import {
  cleanText,
  episodeNumberFromTitle,
  guestsFromDescription,
  guestsFromTitle,
  isoDatePart,
  uniqueNames,
} from "./text";

export const LEX_HOST_NAME = "Lex Fridman";
const LEX_TRANSCRIPT_INDEX = "https://lexfridman.com/category/transcripts/";
/** Index pages inline full transcripts (~3 MB each). */
const INDEX_PAGE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Episode page

export interface LexEpisodePage {
  /** Canonical episode page URL, without trailing slash. */
  url: string;
  slug: string;
  /** As shown on the page, e.g. `#502 – Psychiatry, Insane Asylums, …`. */
  title: string;
  number?: number;
  publishedAt?: string;
  youtubeId?: string;
  /** Link to `<slug>-transcript` found on the page. */
  transcriptUrl?: string;
  /** First paragraph of the description ("X is a historian of …"). */
  description: string;
  /** Guests from the description, else from the title (transcript speakers take precedence later). */
  guests: string[];
}

function canonicalLexUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const recognized = recognizeUrl(url);
    return recognized.kind === "lex" ? recognized.url : undefined;
  } catch {
    return undefined;
  }
}

function youtubeIdIn($: CheerioAPI, scope: string): string | undefined {
  for (const element of $(`${scope} iframe[src], ${scope} a[href]`).toArray()) {
    const link = $(element).attr("src") ?? $(element).attr("href") ?? "";
    const id = extractYoutubeId(link.replace(/^\/\//, "https://"));
    if (id) return id;
  }
  return undefined;
}

/** Parses an episode page. Returns `undefined` if it does not look like one (no entry title). */
export function parseLexEpisodePage(
  html: string,
  fallbackSlug: string,
): LexEpisodePage | undefined {
  const $ = load(html);
  const article = $("article").first();
  const title = cleanText(article.find(".entry-title").first().text());
  if (!title) return undefined;
  const url =
    canonicalLexUrl($('link[rel="canonical"]').attr("href")) ??
    canonicalLexUrl($('meta[property="og:url"]').attr("content")) ??
    lexEpisodeUrl(fallbackSlug);
  const slug = url.slice(url.lastIndexOf("/") + 1);

  const transcriptUrl = article
    .find(".entry-content a[href]")
    .toArray()
    .map((element) => $(element).attr("href") ?? "")
    .find((href) =>
      new RegExp(`^https?://(www\\.)?lexfridman\\.com/${slug}-transcript/?$`, "i").test(href),
    );

  // The description is the first paragraph that is not the player's links.
  let description = "";
  for (const paragraph of article.find(".entry-content > p").toArray()) {
    const node = $(paragraph);
    if (node.hasClass("powerpress_links")) continue;
    node.find("br").replaceWith("\n");
    description = cleanText(node.text())
      .split(/Thank you for listening/i)[0]!
      .trim();
    if (description) break;
  }

  const datetime =
    article.find("time.entry-date").attr("datetime") ??
    $('meta[property="article:published_time"]').attr("content");
  const descriptionGuests = guestsFromDescription(description).filter(
    (name) => name !== LEX_HOST_NAME,
  );
  return {
    url,
    slug,
    title,
    number: episodeNumberFromTitle(title),
    publishedAt: isoDatePart(datetime),
    youtubeId: youtubeIdIn($, "article .entry-content"),
    transcriptUrl: transcriptUrl?.replace(/^http:/, "https:"),
    description,
    guests: descriptionGuests.length
      ? descriptionGuests
      : guestsFromTitle(title, { exclude: [LEX_HOST_NAME] }),
  };
}

// ---------------------------------------------------------------------------
// Transcript page

export interface LexTranscript {
  /** YouTube id of the video the timestamps link to. */
  youtubeId?: string;
  /** From the page title "… | Lex Fridman Podcast #26". */
  number?: number;
  /** Distinct speakers other than Lex, in order of appearance. */
  guests: string[];
  segments: Array<{ speaker?: string; start: number; text: string }>;
  chapters: Array<{ title: string; start: number }>;
}

function parseClock(text: string): number | undefined {
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return undefined;
  const [h, m, s] =
    match[3] === undefined
      ? [0, Number(match[1]), Number(match[2])]
      : [Number(match[1]), Number(match[2]), Number(match[3])];
  return h * 3600 + m * 60 + s;
}

function startFromLink(href: string | undefined): number | undefined {
  if (!href) return undefined;
  const match = /[?&#]t=(\d+)s?\b/.exec(href.replace(/&amp;|&#0?38;/g, "&"));
  return match ? Number(match[1]) : undefined;
}

/**
 * Parses a `-transcript` page: `.ts-segment` (speaker, timestamp link with
 * `t=<seconds>`, text) and `h2[id^=chapter]` chapters, whose start is the
 * first segment after them. Returns no segments if the layout is unknown.
 */
export function parseLexTranscriptPage(html: string): LexTranscript {
  const $ = load(html);
  const content = $(".entry-content").first();
  const scope = content.length ? content : $("body");
  const segments: LexTranscript["segments"] = [];
  const chapters: LexTranscript["chapters"] = [];
  let pendingChapter: string | undefined;
  let youtubeId: string | undefined;

  for (const element of scope.find('h2[id^="chapter"], .ts-segment').toArray()) {
    const node = $(element);
    if (element.tagName === "h2") {
      pendingChapter = cleanText(node.text()) || undefined;
      continue;
    }
    const link = node.find(".ts-timestamp a").first();
    const href = link.attr("href");
    const start = startFromLink(href) ?? parseClock(node.find(".ts-timestamp").text());
    const text = cleanText(node.find(".ts-text").text());
    if (start === undefined || !text) continue;
    youtubeId ??= href ? extractYoutubeId(href.replace(/&amp;|&#0?38;/g, "&")) : undefined;
    const speaker = cleanText(node.find(".ts-name").text()) || undefined;
    segments.push({ ...(speaker ? { speaker } : {}), start, text });
    if (pendingChapter) {
      chapters.push({ title: pendingChapter, start });
      pendingChapter = undefined;
    }
  }

  const pageTitle = cleanText($(".entry-title").first().text() || $("title").text());
  const numberMatch = /Lex Fridman Podcast #(\d+)/i.exec(pageTitle);
  return {
    youtubeId,
    number: numberMatch ? Number(numberMatch[1]) : undefined,
    guests: uniqueNames(
      segments
        .map((segment) => segment.speaker ?? "")
        .filter((name) => name && name !== LEX_HOST_NAME),
    ),
    segments,
    chapters,
  };
}

/** Unified transcript from a parsed Lex transcript page. */
export function toLexTranscriptInput(
  parsed: LexTranscript,
  sourceUrl: string,
  createdAt: string,
): TranscriptInput {
  return {
    source: "lex-official",
    timebase: "youtube",
    sourceUrl,
    createdAt,
    segments: parsed.segments,
    chapters: parsed.chapters,
    extra: {},
  };
}

// ---------------------------------------------------------------------------
// Transcript index → youtubeId map (data/cache/lex-transcripts.json)

export interface LexIndexEntry {
  youtubeId: string;
  transcriptUrl: string;
  episodeUrl?: string;
  title?: string;
}

/**
 * Parses one page of the "transcripts" category: one entry per post whose
 * timestamp/YouTube links give a video id (posts like "…-files" are skipped).
 * `hasOlder` = the page links to an older page.
 */
export function parseLexTranscriptIndexPage(html: string): {
  entries: LexIndexEntry[];
  hasOlder: boolean;
} {
  const $ = load(html);
  const entries: LexIndexEntry[] = [];
  for (const element of $("article").toArray()) {
    const article = $(element);
    const titleLink = article.find(".entry-title a").first();
    const transcriptUrl = titleLink.attr("href")?.trim();
    if (!transcriptUrl || !/-transcript\/?$/.test(transcriptUrl)) continue;
    const timestampHref = article.find(".ts-timestamp a").first().attr("href");
    const youtubeId =
      (timestampHref
        ? extractYoutubeId(timestampHref.replace(/&amp;|&#0?38;/g, "&"))
        : undefined) ?? youtubeIdIn($, `article#${article.attr("id") ?? "missing"} .entry-content`);
    if (!youtubeId) continue;
    const episodeHref = article
      .find("a")
      .toArray()
      .find((link) => /main page/i.test($(link).text()));
    entries.push({
      youtubeId,
      transcriptUrl: transcriptUrl.replace(/^http:/, "https:"),
      episodeUrl: episodeHref ? canonicalLexUrl($(episodeHref).attr("href")) : undefined,
      title: cleanText(titleLink.text()) || undefined,
    });
  }
  const hasOlder =
    $(".nav-previous a").length > 0 || $('a[href*="/category/transcripts/page/"]').length > 0;
  return { entries, hasOlder };
}

const LexMapSchema = z.object({
  version: z.literal(1),
  /** True once a crawl reached the last index page. */
  complete: z.boolean(),
  updatedAt: z.string(),
  entries: z.record(
    z.string(),
    z.object({
      transcriptUrl: z.string(),
      episodeUrl: z.string().optional(),
      title: z.string().optional(),
    }),
  ),
});
type LexMap = z.infer<typeof LexMapSchema>;

export const LEX_MAP_CACHE = "lex-transcripts.json";
/** Safety stop: the index has 13 pages in 2026-11. */
const MAX_INDEX_PAGES = 60;

export function lexIndexPageUrl(page: number): string {
  return page === 1 ? LEX_TRANSCRIPT_INDEX : `${LEX_TRANSCRIPT_INDEX}page/${page}/`;
}

export interface LexLookupDeps {
  http: Http;
  now: () => Date;
  progress?: (message: string) => void;
}

/**
 * Finds the transcript page for a YouTube id through the cached map. If the
 * id is missing, the map is refreshed by crawling the index from page 1 until
 * the id is found, or — when the map was already complete — until a page
 * brings nothing new, or until the last page (then the map is complete).
 * The cache is written after every page, so an interrupted crawl keeps its progress.
 */
export async function findLexTranscriptByYoutubeId(
  youtubeId: string,
  deps: LexLookupDeps,
): Promise<LexIndexEntry | undefined> {
  const cached = await readCache(LEX_MAP_CACHE, LexMapSchema);
  const map: LexMap = cached ?? {
    version: 1,
    complete: false,
    updatedAt: deps.now().toISOString(),
    entries: {},
  };
  const hit = (): LexIndexEntry | undefined => {
    const entry = map.entries[youtubeId];
    return entry ? { youtubeId, ...entry } : undefined;
  };
  if (hit()) return hit();

  const wasComplete = map.complete;
  for (let page = 1; page <= MAX_INDEX_PAGES; page++) {
    deps.progress?.(`Lex transcript index: reading page ${page}…`);
    const html = await deps.http.textIfExists(lexIndexPageUrl(page), {
      timeoutMs: INDEX_PAGE_TIMEOUT_MS,
    });
    const parsed = html ? parseLexTranscriptIndexPage(html) : { entries: [], hasOlder: false };
    let added = 0;
    for (const entry of parsed.entries) {
      if (!map.entries[entry.youtubeId]) added++;
      const { youtubeId: id, ...rest } = entry;
      map.entries[id] = rest;
    }
    const reachedEnd = !html || parsed.entries.length === 0 || !parsed.hasOlder;
    if (reachedEnd) map.complete = true;
    map.updatedAt = deps.now().toISOString();
    await writeCache(LEX_MAP_CACHE, map);
    if (hit() || reachedEnd || (wasComplete && added === 0)) break;
  }
  return hit();
}
