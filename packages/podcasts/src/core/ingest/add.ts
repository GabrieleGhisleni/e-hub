/**
 * Adding an episode from a URL (DESIGN.md §6), shared by the CLI
 * (`pnpm episode add`) and the local server (phase 7):
 *
 * 1. `previewAdd(url)` — what would happen, without writing anything:
 *    duplicate (existing slug) | ready (source, metadata, existing/new show
 *    with iTunes feed candidates to confirm, transcript availability).
 * 2. `addEpisode(url, {feed, addedAt})` — creates the show if new (confirmed
 *    feed or none; image through core), fetches the transcript when available
 *    and creates the episode + transcript through `createEpisode`.
 *
 * All network access goes through `deps.fetch` / `deps.git`.
 */
import { createEpisode } from "../episodes";
import { DuplicateEpisodeError, NotFoundError, ValidationError } from "../errors";
import { HttpUrl, type Episode, type Show, type ShowInput, type TranscriptInput } from "../schema";
import { createShow, findShowByYoutubeAuthorUrl } from "../shows";
import { slugify } from "../slug";
import { listEpisodes, listShowSlugs, readShowIfExists } from "../store";
import { findMatchingEpisode } from "../urls";
import { fetchFeed, findFeedItem, type FeedItem } from "./feed";
import { runGit, type GitRunner } from "./git";
import { createHttp, HttpError, type FetchLike, type Http } from "./http";
import {
  findWikiEntry,
  HUBERMAN_HOST_NAME,
  loadWikiIndex,
  readWikiTranscript,
  syncWiki,
  wikiFileUrl,
  wikiGuests,
  type WikiEntry,
  type WikiSync,
} from "./huberman";
import { searchFeedCandidates, type FeedCandidate } from "./itunes";
import {
  KNOWN_SHOWS,
  knownShowByAuthorUrl,
  knownShowBySource,
  type KnownShow,
} from "./known-shows";
import {
  findLexTranscriptByYoutubeId,
  LEX_HOST_NAME,
  parseLexEpisodePage,
  parseLexTranscriptPage,
  toLexTranscriptInput,
  type LexEpisodePage,
} from "./lex";
import { canonicalYoutubeUrl, lexEpisodeUrl, recognizeUrl, type RecognizedUrl } from "./recognize";
import { episodeNumberFromTitle, guestsFromTitle, normalizeTitle, uniqueNames } from "./text";
import {
  fetchChannelAvatar,
  fetchVideoInfo,
  fetchWatchPage,
  stripChannelSuffix,
  type YoutubeVideoInfo,
} from "./youtube";

// ---------------------------------------------------------------------------
// Public types

export interface IngestDeps {
  /** Default: global `fetch`. */
  fetch?: FetchLike;
  /** Default: the system `git`. */
  git?: GitRunner;
  /** Default: `new Date()`. */
  now?: () => Date;
  /** Progress messages for long steps (index crawl, clone). */
  progress?: (message: string) => void;
}

export type IngestSource = "lex" | "huberman" | "youtube";

export interface EpisodeDraft {
  title: string;
  guests: string[];
  number?: number;
  /** `YYYY-MM-DD`. */
  publishedAt?: string;
}

export type ShowPreview =
  | { status: "existing"; slug: string; name: string }
  | {
      status: "new";
      slug: string;
      name: string;
      host: string;
      /** Lex/Huberman: a built-in show whose file is missing (created with its hand-entered feed). */
      known: boolean;
      youtubeAuthorUrl?: string;
      /** Built-in shows only: the feed that will be set. */
      feedUrl?: string;
      /** Channel avatar (used as the image unless a confirmed feed has a cover). */
      avatarUrl?: string;
      /** iTunes candidates to confirm (generic shows). */
      feedCandidates: FeedCandidate[];
      /** True when `addEpisode` needs `feed` (a URL or `null`). */
      needsFeedDecision: boolean;
    };

export type TranscriptPreview =
  | { status: "available"; source: "lex-official" | "patrykwajs-wiki"; url: string }
  | { status: "none"; reason: string };

export interface ExistingEpisodeRef {
  slug: string;
  title: string;
  show: string;
}

export type AddPreview =
  | {
      status: "duplicate";
      url: string;
      existing: ExistingEpisodeRef;
      matchedBy: "youtubeId" | "url";
      warnings: string[];
    }
  | {
      status: "ready";
      source: IngestSource;
      /** URL that will be stored (canonical episode page when known, else the YouTube watch URL). */
      url: string;
      youtubeId?: string;
      episode: EpisodeDraft;
      show: ShowPreview;
      transcript: TranscriptPreview;
      warnings: string[];
    };

export interface AddEpisodeOptions {
  /** `--added-at` (initial import only): `YYYY-MM-DD` or ISO datetime. Default: now. */
  addedAt?: string | Date;
  /**
   * Feed decision for a **new** show: a URL (confirmed — a candidate or any
   * other feed) or `null` (no feed, YouTube only). Required when the preview
   * says `needsFeedDecision`; ignored (with a warning) for existing shows.
   */
  feed?: string | null;
}

export type TranscriptOutcome =
  | {
      status: "saved";
      source: "lex-official" | "patrykwajs-wiki";
      timebase: "youtube";
      segments: number;
      chapters: number;
      /** Wiki paragraphs whose start was interpolated between timestamps. */
      estimatedStarts: boolean;
    }
  | { status: "none"; reason: string };

export type AddResult =
  | {
      status: "duplicate";
      existing: ExistingEpisodeRef;
      matchedBy: "youtubeId" | "url";
      warnings: string[];
    }
  | {
      status: "created";
      episode: Episode;
      show: { slug: string; name: string; created: boolean; feedUrl?: string; image?: string };
      transcript: TranscriptOutcome;
      warnings: string[];
    };

/** `addEpisode` was called for a new show with feed candidates but without a decision. */
export class FeedDecisionRequiredError extends ValidationError {
  readonly candidates: FeedCandidate[];

  constructor(showName: string, candidates: FeedCandidate[]) {
    super(
      `new show '${showName}': confirm a podcast feed (feed: <url>) or choose none (feed: null)`,
      candidates.map((c) => `candidate: ${c.feedUrl} — ${c.title} (${c.author}, ${c.match} match)`),
    );
    this.candidates = candidates;
  }
}

// ---------------------------------------------------------------------------
// Resolution (shared by preview and add)

interface NewShowProposal {
  input: ShowInput & { slug: string; name: string; host: string };
  avatarUrl?: string;
  feedCandidates: FeedCandidate[];
}

type ShowResolution =
  | { status: "existing"; show: Show }
  | { status: "known"; known: KnownShow }
  | { status: "new"; proposal: NewShowProposal };

type TranscriptPlan =
  | { kind: "lex"; url: string }
  | { kind: "wiki"; sync: WikiSync; entry: WikiEntry }
  | { kind: "none"; reason: string };

interface Resolution {
  source: IngestSource;
  url: string;
  youtubeId?: string;
  draft: EpisodeDraft;
  show: ShowResolution;
  transcript: TranscriptPlan;
  warnings: string[];
}

interface Context {
  http: Http;
  git: GitRunner;
  now: () => Date;
  progress?: (message: string) => void;
}

function context(deps: IngestDeps): Context {
  return {
    http: createHttp(deps.fetch),
    git: deps.git ?? runGit,
    now: deps.now ?? (() => new Date()),
    progress: deps.progress,
  };
}

async function findDuplicate(query: { url?: string; youtubeId?: string }) {
  const match = findMatchingEpisode(await listEpisodes(), query);
  if (!match) return undefined;
  const { slug, title, show } = match.episode;
  return { existing: { slug, title, show }, matchedBy: match.matchedBy };
}

async function resolveKnownShow(known: KnownShow): Promise<ShowResolution> {
  const existing =
    (await readShowIfExists(known.show.slug)) ??
    (await findShowByYoutubeAuthorUrl(known.show.youtubeAuthorUrl));
  return existing ? { status: "existing", show: existing } : { status: "known", known };
}

/** Lex episode page → metadata; `undefined` on 404. */
async function fetchLexEpisodePage(ctx: Context, url: string): Promise<LexEpisodePage | undefined> {
  const recognized = recognizeUrl(url);
  if (recognized.kind !== "lex") return undefined;
  const html = await ctx.http.textIfExists(`${lexEpisodeUrl(recognized.slug)}/`);
  if (html === undefined) return undefined;
  const page = parseLexEpisodePage(html, recognized.slug);
  if (!page) throw new ValidationError(`not a Lex Fridman episode page: ${url}`);
  return page;
}

async function resolveLexFromSite(ctx: Context, recognized: RecognizedUrl): Promise<Resolution> {
  const page = await fetchLexEpisodePage(ctx, recognized.url);
  if (!page) throw new NotFoundError(`Lex Fridman episode page not found: ${recognized.url}`);
  const warnings: string[] = [];
  let transcript: TranscriptPlan = { kind: "none", reason: "no official transcript page found" };
  if (page.transcriptUrl) transcript = { kind: "lex", url: page.transcriptUrl };
  else if (page.youtubeId) {
    const entry = await findLexTranscriptByYoutubeId(page.youtubeId, ctx);
    if (entry) transcript = { kind: "lex", url: entry.transcriptUrl };
  }
  return {
    source: "lex",
    url: page.url,
    youtubeId: page.youtubeId,
    draft: {
      title: page.title,
      guests: page.guests,
      number: page.number,
      publishedAt: page.publishedAt,
    },
    show: await resolveKnownShow(knownShowBySource("lex")),
    transcript,
    warnings,
  };
}

/** "Title | Lex Fridman Podcast #502" → "#502 – Title". */
function lexTitleFromYoutube(title: string): { title: string; number?: number } {
  const match = /^(.*?)\s*\|\s*Lex Fridman Podcast\s*#(\d+)\s*$/i.exec(title);
  if (match) return { title: `#${match[2]} – ${match[1]}`, number: Number(match[2]) };
  return { title, number: episodeNumberFromTitle(title) };
}

async function resolveLexFromYoutube(ctx: Context, info: YoutubeVideoInfo): Promise<Resolution> {
  const show = await resolveKnownShow(knownShowBySource("lex"));
  const entry = await findLexTranscriptByYoutubeId(info.youtubeId, ctx);
  if (entry) {
    const episodeUrl = entry.episodeUrl ?? entry.transcriptUrl.replace(/-transcript\/?$/, "");
    const page = await fetchLexEpisodePage(ctx, episodeUrl);
    if (page) {
      return {
        source: "lex",
        url: page.url,
        youtubeId: info.youtubeId,
        draft: {
          title: page.title,
          guests: page.guests,
          number: page.number,
          publishedAt: page.publishedAt,
        },
        show,
        transcript: { kind: "lex", url: entry.transcriptUrl },
        warnings:
          page.youtubeId && page.youtubeId !== info.youtubeId
            ? [`the Lex episode page embeds a different video (${page.youtubeId})`]
            : [],
      };
    }
  }
  const { title, number } = lexTitleFromYoutube(info.title);
  const watch = await fetchWatchPage(ctx.http, info.youtubeId);
  return {
    source: "lex",
    url: canonicalYoutubeUrl(info.youtubeId),
    youtubeId: info.youtubeId,
    draft: {
      title,
      guests: guestsFromTitle(info.title, { exclude: [LEX_HOST_NAME, "Lex Fridman Podcast"] }),
      number,
      publishedAt: watch?.publishedAt,
    },
    show,
    transcript: {
      kind: "none",
      reason: entry
        ? "the transcript's episode page could not be read"
        : "no official transcript on lexfridman.com for this video",
    },
    warnings: [],
  };
}

async function resolveHuberman(
  ctx: Context,
  query: { youtubeId?: string; title?: string; siteUrl?: string },
): Promise<Resolution> {
  const known = knownShowBySource("huberman");
  const warnings: string[] = [];

  let item: FeedItem | undefined;
  try {
    const feed = await fetchFeed(ctx.http, known.show.feedUrl);
    item = findFeedItem(feed.items, { link: query.siteUrl, title: query.title });
  } catch (error) {
    if (query.siteUrl) throw error;
    warnings.push(
      `Huberman Lab feed unavailable (no official number/date): ${(error as Error).message}`,
    );
  }
  if (query.siteUrl && !item)
    throw new NotFoundError(
      `episode not found in the Huberman Lab feed: ${query.siteUrl} (try its YouTube URL)`,
    );
  const title = query.title ?? item!.title;

  let wiki: { sync: WikiSync; entry: WikiEntry } | undefined;
  let wikiProblem = "not in the PatrykWajs wiki (yet)";
  try {
    const sync = await syncWiki(ctx.git, { progress: ctx.progress, now: ctx.now });
    warnings.push(...sync.warnings);
    const match = findWikiEntry(await loadWikiIndex(sync), { youtubeId: query.youtubeId, title });
    if (match) wiki = { sync, entry: match.entry };
  } catch (error) {
    wikiProblem = "the PatrykWajs wiki is unavailable";
    warnings.push(`Huberman wiki unavailable: ${(error as Error).message}`);
  }

  const youtubeId = query.youtubeId ?? wiki?.entry.youtubeId;
  let publishedAt = item?.publishedAt ?? wiki?.entry.date;
  if (!publishedAt && youtubeId)
    publishedAt = (await fetchWatchPage(ctx.http, youtubeId))?.publishedAt;
  const linkUrl = item?.link ? safeRecognize(item.link) : undefined;
  const url =
    (linkUrl?.kind === "huberman" ? linkUrl.url : undefined) ??
    (youtubeId ? canonicalYoutubeUrl(youtubeId) : query.siteUrl!);

  let guests = wiki ? wikiGuests(wiki.entry) : [];
  if (guests.length === 0)
    guests = guestsFromTitle(title, { exclude: [HUBERMAN_HOST_NAME, known.show.name] });
  if (query.siteUrl && !youtubeId)
    warnings.push("YouTube video not identified (no wiki match): saved without YouTube id");

  return {
    source: "huberman",
    url,
    youtubeId,
    draft: { title, guests, number: item?.number, publishedAt },
    show: await resolveKnownShow(known),
    transcript: wiki ? { kind: "wiki", ...wiki } : { kind: "none", reason: wikiProblem },
    warnings,
  };
}

function safeRecognize(url: string): RecognizedUrl | undefined {
  try {
    return recognizeUrl(url);
  } catch {
    return undefined;
  }
}

async function uniqueShowSlug(name: string): Promise<string> {
  const base = slugify(name, 60) || "youtube-channel";
  const taken = new Set([...(await listShowSlugs()), ...KNOWN_SHOWS.map((k) => k.show.slug)]);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function resolveGenericYoutube(ctx: Context, info: YoutubeVideoInfo): Promise<Resolution> {
  const warnings: string[] = [];
  const existing = await findShowByYoutubeAuthorUrl(info.authorUrl);
  let show: ShowResolution;
  if (existing) show = { status: "existing", show: existing };
  else {
    const name = info.authorName || info.authorUrl.replace(/^.*\/@?/, "");
    let feedCandidates: FeedCandidate[] = [];
    try {
      feedCandidates = await searchFeedCandidates(ctx.http, name, [name]);
    } catch (error) {
      warnings.push(`iTunes search failed (no feed proposed): ${(error as Error).message}`);
    }
    show = {
      status: "new",
      proposal: {
        input: {
          slug: await uniqueShowSlug(name),
          name,
          host: name,
          links: { youtube: info.authorUrl },
          youtubeAuthorUrl: info.authorUrl,
        },
        avatarUrl: await fetchChannelAvatar(ctx.http, info.authorUrl),
        feedCandidates,
      },
    };
  }
  const channelNames = [info.authorName, ...(existing ? [existing.name, existing.host] : [])];
  const title = stripChannelSuffix(info.title, channelNames);
  const watch = await fetchWatchPage(ctx.http, info.youtubeId);
  if (!watch?.publishedAt) warnings.push("publication date not found on the YouTube page");
  return {
    source: "youtube",
    url: canonicalYoutubeUrl(info.youtubeId),
    youtubeId: info.youtubeId,
    draft: {
      title,
      guests: guestsFromTitle(title, { exclude: channelNames }),
      number: episodeNumberFromTitle(title),
      publishedAt: watch?.publishedAt,
    },
    show,
    transcript: { kind: "none", reason: "no transcript source for this channel" },
    warnings,
  };
}

type EarlyOutcome = {
  duplicate: NonNullable<Awaited<ReturnType<typeof findDuplicate>>>;
  url: string;
};

/** Full resolution, or an early duplicate. */
async function resolve(ctx: Context, input: string): Promise<Resolution | EarlyOutcome> {
  const recognized = recognizeUrl(input);
  const early = await findDuplicate({
    url: recognized.url,
    youtubeId: recognized.kind === "youtube" ? recognized.youtubeId : undefined,
  });
  if (early) return { duplicate: early, url: recognized.url };

  let resolution: Resolution;
  if (recognized.kind === "lex") resolution = await resolveLexFromSite(ctx, recognized);
  else if (recognized.kind === "huberman")
    resolution = await resolveHuberman(ctx, { siteUrl: recognized.url });
  else {
    const info = await fetchVideoInfo(ctx.http, recognized.youtubeId);
    const known = knownShowByAuthorUrl(info.authorUrl);
    if (known?.source === "lex") resolution = await resolveLexFromYoutube(ctx, info);
    else if (known?.source === "huberman")
      resolution = await resolveHuberman(ctx, { youtubeId: info.youtubeId, title: info.title });
    else resolution = await resolveGenericYoutube(ctx, info);
  }
  const late = await findDuplicate({ url: resolution.url, youtubeId: resolution.youtubeId });
  if (late) return { duplicate: late, url: resolution.url };
  return resolution;
}

function showPreview(show: ShowResolution): ShowPreview {
  if (show.status === "existing")
    return { status: "existing", slug: show.show.slug, name: show.show.name };
  if (show.status === "known") {
    const input = show.known.show;
    return {
      status: "new",
      slug: input.slug,
      name: input.name,
      host: input.host,
      known: true,
      youtubeAuthorUrl: input.youtubeAuthorUrl,
      feedUrl: input.feedUrl,
      feedCandidates: [],
      needsFeedDecision: false,
    };
  }
  const { input, avatarUrl, feedCandidates } = show.proposal;
  return {
    status: "new",
    slug: input.slug,
    name: input.name,
    host: input.host,
    known: false,
    youtubeAuthorUrl: input.youtubeAuthorUrl,
    avatarUrl,
    feedCandidates,
    needsFeedDecision: feedCandidates.length > 0,
  };
}

function transcriptPreview(plan: TranscriptPlan): TranscriptPreview {
  if (plan.kind === "lex") return { status: "available", source: "lex-official", url: plan.url };
  if (plan.kind === "wiki")
    return {
      status: "available",
      source: "patrykwajs-wiki",
      url: wikiFileUrl(plan.sync.head, plan.entry.path),
    };
  return { status: "none", reason: plan.reason };
}

/** What `addEpisode(url)` would do. Reads the network (and syncs caches), writes no data. */
export async function previewAdd(url: string, deps: IngestDeps = {}): Promise<AddPreview> {
  const resolved = await resolve(context(deps), url);
  if ("duplicate" in resolved)
    return { status: "duplicate", url: resolved.url, ...resolved.duplicate, warnings: [] };
  return {
    status: "ready",
    source: resolved.source,
    url: resolved.url,
    youtubeId: resolved.youtubeId,
    episode: resolved.draft,
    show: showPreview(resolved.show),
    transcript: transcriptPreview(resolved.transcript),
    warnings: resolved.warnings,
  };
}

// ---------------------------------------------------------------------------
// Add

interface FetchedTranscript {
  input?: TranscriptInput;
  outcome: TranscriptOutcome;
  youtubeId?: string;
  guests?: string[];
  number?: number;
}

async function fetchTranscript(
  ctx: Context,
  plan: TranscriptPlan,
  warnings: string[],
): Promise<FetchedTranscript> {
  const createdAt = ctx.now().toISOString();
  if (plan.kind === "none") return { outcome: { status: "none", reason: plan.reason } };
  if (plan.kind === "wiki") {
    const input = await readWikiTranscript(plan.sync, plan.entry, createdAt);
    if (!input) {
      warnings.push("the wiki transcript has no timestamps: saved without transcript");
      return { outcome: { status: "none", reason: "wiki transcript without timestamps" } };
    }
    return {
      input,
      outcome: {
        status: "saved",
        source: "patrykwajs-wiki",
        timebase: "youtube",
        segments: input.segments.length,
        chapters: input.chapters?.length ?? 0,
        estimatedStarts: input.extra?.estimatedStarts === true,
      },
    };
  }
  ctx.progress?.(`Fetching transcript ${plan.url}…`);
  const html = await ctx.http.textIfExists(plan.url, { timeoutMs: 60_000 });
  if (html === undefined) {
    warnings.push(`transcript page not found: ${plan.url}`);
    return { outcome: { status: "none", reason: "transcript page not found" } };
  }
  const parsed = parseLexTranscriptPage(html);
  if (parsed.segments.length === 0) {
    warnings.push(
      `no segments found in ${plan.url} (page layout changed? the parser may need an update): saved without transcript`,
    );
    return { outcome: { status: "none", reason: "transcript page not parsable" } };
  }
  const input = toLexTranscriptInput(parsed, plan.url.replace(/\/$/, ""), createdAt);
  return {
    input,
    outcome: {
      status: "saved",
      source: "lex-official",
      timebase: "youtube",
      segments: parsed.segments.length,
      chapters: parsed.chapters.length,
      estimatedStarts: false,
    },
    youtubeId: parsed.youtubeId,
    guests: parsed.guests,
    number: parsed.number,
  };
}

async function downloadImage(ctx: Context, url: string | undefined, warnings: string[]) {
  if (!url) return undefined;
  try {
    return await ctx.http.bytes(url);
  } catch (error) {
    warnings.push(`show image not downloaded (${url}): ${(error as Error).message}`);
    return undefined;
  }
}

/** Creates the show with an image when possible; an unusable image never blocks the show. */
async function createShowWithImage(
  input: ShowInput,
  image: Uint8Array | undefined,
  warnings: string[],
): Promise<Show> {
  if (image) {
    try {
      return await createShow(input, { imageSource: image });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      warnings.push(`show image not usable: ${error.describe()}`);
    }
  }
  return createShow(input);
}

async function ensureShow(
  ctx: Context,
  resolution: ShowResolution,
  feed: string | null | undefined,
  warnings: string[],
): Promise<{ show: Show; created: boolean }> {
  if (resolution.status === "existing") {
    if (feed !== undefined) warnings.push("feed option ignored: the show already exists");
    return { show: resolution.show, created: false };
  }
  if (resolution.status === "known") {
    if (feed !== undefined)
      warnings.push("feed option ignored: built-in show with a hand-entered feed");
    const input = resolution.known.show;
    let cover: string | undefined;
    try {
      cover = (await fetchFeed(ctx.http, input.feedUrl)).coverUrl;
    } catch (error) {
      warnings.push(`feed cover unavailable: ${(error as Error).message}`);
    }
    const show = await createShowWithImage(
      input,
      await downloadImage(ctx, cover, warnings),
      warnings,
    );
    return { show, created: true };
  }

  const { input, avatarUrl, feedCandidates } = resolution.proposal;
  if (feed === undefined && feedCandidates.length > 0)
    throw new FeedDecisionRequiredError(input.name, feedCandidates);
  let feedUrl: string | undefined;
  let cover: string | undefined;
  if (typeof feed === "string") {
    const parsedUrl = HttpUrl.safeParse(feed.trim());
    if (!parsedUrl.success) throw new ValidationError(`invalid feed URL '${feed}'`);
    feedUrl = parsedUrl.data;
    try {
      cover = (await fetchFeed(ctx.http, feedUrl)).coverUrl;
    } catch (error) {
      throw new ValidationError(`cannot read the feed ${feedUrl}`, [(error as Error).message]);
    }
    cover ??= feedCandidates.find((candidate) => candidate.feedUrl === feedUrl)?.artworkUrl;
  }
  const image =
    (await downloadImage(ctx, cover, warnings)) ?? (await downloadImage(ctx, avatarUrl, warnings));
  if (!image) warnings.push("new show created without an image");
  const show = await createShowWithImage({ ...input, feedUrl }, image, warnings);
  return { show, created: true };
}

/** `names` sorted by their position in `preferred` (unknown names last, in their original order). */
function orderLike(names: string[], preferred: string[]): string[] {
  const keys = preferred.map(normalizeTitle);
  const rank = (name: string) => {
    const index = keys.indexOf(normalizeTitle(name));
    return index < 0 ? keys.length : index;
  };
  return names
    .map((name, index) => ({ name, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map(({ name }) => name);
}

/**
 * Adds the episode behind `url` (see the module comment). Returns
 * `{status: "duplicate"}` if it already exists. Throws `ValidationError`
 * (unsupported URL, bad options, `FeedDecisionRequiredError`),
 * `NotFoundError` (page/video not found), `HttpError` (network: nothing written).
 */
export async function addEpisode(
  url: string,
  options: AddEpisodeOptions = {},
  deps: IngestDeps = {},
): Promise<AddResult> {
  const ctx = context(deps);
  const resolved = await resolve(ctx, url);
  if ("duplicate" in resolved) return { status: "duplicate", ...resolved.duplicate, warnings: [] };
  const warnings = [...resolved.warnings];

  // Transcript first: a network failure here must not leave a half-created show.
  const transcript = await fetchTranscript(ctx, resolved.transcript, warnings);
  let youtubeId = resolved.youtubeId;
  if (transcript.youtubeId && transcript.youtubeId !== youtubeId) {
    if (youtubeId)
      warnings.push(
        `the transcript links to video ${transcript.youtubeId}, the page to ${youtubeId}: using the transcript's`,
      );
    youtubeId = transcript.youtubeId;
  }
  const draft = resolved.draft;
  // Transcript speakers are authoritative (exact set); the page's order is the intended one.
  const guests = uniqueNames(
    transcript.guests?.length ? orderLike(transcript.guests, draft.guests) : draft.guests,
  );

  const { show, created } = await ensureShow(ctx, resolved.show, options.feed, warnings);
  let episode: Episode;
  try {
    episode = await createEpisode(
      {
        show: show.slug,
        title: draft.title,
        url: resolved.url,
        guests,
        number: draft.number ?? transcript.number,
        youtubeId,
        publishedAt: draft.publishedAt,
        addedAt: options.addedAt,
        transcript: transcript.input,
      },
      { now: ctx.now() },
    );
  } catch (error) {
    if (!(error instanceof DuplicateEpisodeError)) throw error;
    const duplicate = await findDuplicate({ url: resolved.url, youtubeId });
    return {
      status: "duplicate",
      existing: duplicate?.existing ?? { slug: error.existingSlug, title: "", show: "" },
      matchedBy: duplicate?.matchedBy ?? "url",
      warnings,
    };
  }
  return {
    status: "created",
    episode,
    show: { slug: show.slug, name: show.name, created, feedUrl: show.feedUrl, image: show.image },
    transcript: transcript.outcome,
    warnings,
  };
}

export { HttpError };
