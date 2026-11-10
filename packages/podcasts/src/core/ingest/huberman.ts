/**
 * Huberman Lab transcripts from the PatrykWajs/Huberman-Lab-Wiki repo
 * (DESIGN.md §6.1): a shallow clone in `data/cache/huberman-wiki`, pulled on
 * every Huberman ingest, plus an index (`youtube_id` / title → file) rebuilt
 * when the clone's HEAD changes. hubermanlab.com is never fetched (paywall).
 *
 * The wiki's `transcript.md` files are not uniform (see docs/progress/phase-4.md):
 * chapter headings with untimed paragraphs, `[HH:MM:SS] text` lines, bold
 * speaker labels… `parseWikiTranscript` handles all of them.
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { TranscriptInput } from "../schema";
import { extractYoutubeId } from "../urls";
import { cachePath, readCache, writeCache } from "./cache";
import type { GitRunner } from "./git";
import {
  cleanPersonName,
  cleanText,
  isoDatePart,
  looksLikePersonName,
  normalizeTitle,
  titlesMatch,
  uniqueNames,
} from "./text";

export const HUBERMAN_HOST_NAME = "Andrew Huberman";
export const WIKI_REPO_URL = "https://github.com/PatrykWajs/Huberman-Lab-Wiki";
export const WIKI_DIR = "huberman-wiki";
export const WIKI_INDEX_CACHE = "huberman-wiki-index.json";

// ---------------------------------------------------------------------------
// Clone / pull

export interface WikiSync {
  dir: string;
  head: string;
  warnings: string[];
}

/** Last successful pull per clone dir in this process (a preview followed by an add pulls once). */
const recentPulls = new Map<string, number>();
const PULL_REUSE_MS = 10 * 60_000;

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/**
 * Clones the wiki (`git clone --depth 1`) if missing, otherwise `git pull`s it.
 * A failed pull keeps the existing clone (warning); a failed clone throws.
 */
export async function syncWiki(
  git: GitRunner,
  options: { progress?: (message: string) => void; now?: () => Date } = {},
): Promise<WikiSync> {
  const dir = cachePath(WIKI_DIR);
  const warnings: string[] = [];
  const now = (options.now ?? (() => new Date()))().getTime();
  if (!(await exists(path.join(dir, ".git")))) {
    options.progress?.(`Cloning ${WIKI_REPO_URL} (shallow, ~80 MB)…`);
    await git(["clone", "--depth", "1", "--quiet", WIKI_REPO_URL, dir]);
    recentPulls.set(dir, now);
  } else if (now - (recentPulls.get(dir) ?? -Infinity) > PULL_REUSE_MS) {
    options.progress?.("Updating the Huberman wiki clone (git pull)…");
    try {
      await git(["pull", "--ff-only", "--quiet"], { cwd: dir });
      recentPulls.set(dir, now);
    } catch (error) {
      warnings.push(
        `git pull of the Huberman wiki failed, using the local copy: ${(error as Error).message}`,
      );
    }
  }
  const head = (await git(["rev-parse", "HEAD"], { cwd: dir })).trim();
  return { dir, head, warnings };
}

// ---------------------------------------------------------------------------
// Index

export const WikiEntry = z.object({
  /** Path of transcript.md relative to the clone (posix separators). */
  path: z.string(),
  title: z.string(),
  youtubeId: z.string().optional(),
  /** The wiki's own sequential number (not the official episode number). */
  wikiNumber: z.number().optional(),
  date: z.string().optional(),
  speakers: z.array(z.string()),
});
export type WikiEntry = z.infer<typeof WikiEntry>;

const WikiIndex = z.object({
  version: z.literal(1),
  head: z.string(),
  entries: z.array(WikiEntry),
});
type WikiIndex = z.infer<typeof WikiIndex>;

/** Splits `---\nyaml\n---\nbody`; frontmatter `{}` if absent or invalid. */
export function splitFrontmatter(markdown: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { data: {}, body: markdown };
  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch {
    data = {};
  }
  return {
    data:
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {},
    body: markdown.slice(match[0].length),
  };
}

function scalar(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(scalar).filter((item): item is string => !!item);
  const single = scalar(value);
  return single ? single.split(/\s*,\s*/).filter(Boolean) : [];
}

/** Index entry from a transcript.md (frontmatter keys vary across the wiki). */
export function wikiEntryFromMarkdown(relativePath: string, markdown: string): WikiEntry {
  const { data, body } = splitFrontmatter(markdown);
  const idValue = scalar(data.youtube_id) ?? scalar(data.video_id);
  const urlValue = scalar(data.youtube_url) ?? scalar(data.url);
  const youtubeId =
    (idValue && /^[A-Za-z0-9_-]{11}$/.test(idValue) ? idValue : undefined) ??
    (urlValue ? extractYoutubeId(urlValue) : undefined);
  const dirName = path.posix.basename(path.posix.dirname(relativePath));
  const title =
    scalar(data.title) ??
    scalar(data.episode_title) ??
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ??
    dirName.replace(/^EP-?\d+\s*-\s*/i, "");
  const number = Number(scalar(data.episode_number) ?? scalar(data.ep_num) ?? scalar(data.episode));
  const speakers = stringList(data.speakers);
  if (speakers.length === 0) speakers.push(...stringList(data.host), ...stringList(data.guest));
  return {
    path: relativePath,
    title: cleanText(title),
    youtubeId,
    wikiNumber: Number.isInteger(number) && number > 0 ? number : undefined,
    date: isoDatePart(scalar(data.episode_date) ?? scalar(data.publish_date) ?? scalar(data.date)),
    speakers: uniqueNames(speakers),
  };
}

async function buildWikiIndex(dir: string, head: string): Promise<WikiIndex> {
  const files = (await readdir(dir, { recursive: true }))
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith("/transcript.md") && !file.startsWith(".git/"))
    .sort();
  const entries = await Promise.all(
    files.map(async (file) =>
      wikiEntryFromMarkdown(file, await readFile(path.join(dir, file), "utf8")),
    ),
  );
  return { version: 1, head, entries };
}

/** The index for the clone's current HEAD (cached in `data/cache/`, rebuilt when HEAD changes). */
export async function loadWikiIndex(sync: WikiSync): Promise<WikiEntry[]> {
  const cached = await readCache(WIKI_INDEX_CACHE, WikiIndex);
  if (cached && cached.head === sync.head) return cached.entries;
  const index = await buildWikiIndex(sync.dir, sync.head);
  await writeCache(WIKI_INDEX_CACHE, index);
  return index.entries;
}

/**
 * Wiki entry for an episode: by YouTube id, then by title (normalised equal,
 * then unique prefix match). Never by number: the wiki numbers episodes its
 * own way (EP-374 in the wiki is official episode 270).
 */
export function findWikiEntry(
  entries: readonly WikiEntry[],
  query: { youtubeId?: string; title?: string },
): { entry: WikiEntry; matchedBy: "youtubeId" | "title" } | undefined {
  if (query.youtubeId) {
    const entry = entries.find((candidate) => candidate.youtubeId === query.youtubeId);
    if (entry) return { entry, matchedBy: "youtubeId" };
  }
  if (query.title) {
    const wanted = normalizeTitle(query.title);
    const exact = entries.filter((candidate) => normalizeTitle(candidate.title) === wanted);
    const matches = exact.length
      ? exact
      : entries.filter((candidate) => titlesMatch(candidate.title, query.title!));
    // A title match must not contradict a known, different YouTube id.
    const usable = matches.filter(
      (candidate) =>
        !query.youtubeId || !candidate.youtubeId || candidate.youtubeId === query.youtubeId,
    );
    if (usable.length === 1) return { entry: usable[0]!, matchedBy: "title" };
  }
  return undefined;
}

/** Guests from wiki speakers: everyone but the host, honorifics and nicknames stripped. */
export function wikiGuests(entry: WikiEntry): string[] {
  const host = normalizeTitle(HUBERMAN_HOST_NAME);
  return uniqueNames(
    entry.speakers.map(cleanPersonName).filter((name) => name && normalizeTitle(name) !== host),
  );
}

export function wikiFileUrl(head: string, relativePath: string): string {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${WIKI_REPO_URL}/blob/${head}/${encoded}`;
}

// ---------------------------------------------------------------------------
// transcript.md → unified transcript

export interface WikiTranscript {
  segments: Array<{ speaker?: string; start: number; text: string }>;
  chapters: Array<{ title: string; start: number }>;
  /** True if some segment starts were interpolated between timestamps. */
  estimatedStarts: boolean;
}

const TS = String.raw`(\d{1,2}:\d{2}(?::\d{2})?)`;
/** Average speech rate used to extrapolate after the last timestamp (150 words/min). */
const DEFAULT_SECONDS_PER_WORD = 0.4;

function clockSeconds(text: string): number {
  const parts = text.split(":").map(Number);
  return parts.length === 3
    ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    : parts[0]! * 60 + parts[1]!;
}

function stripMarkup(text: string): string {
  return cleanText(
    text
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\*\*|__|`/g, "")
      .replace(/^\*+|\*+$/g, ""),
  );
}

/** Heading text → chapter title and optional start (`[00:01:02] T`, `00:01:02 - T`, `T (00:01:02)`). */
function parseHeading(text: string): { title?: string; start?: number } {
  const patterns = [
    new RegExp(String.raw`^\[${TS}\]\s*[-–—:]?\s*(.*)$`),
    new RegExp(String.raw`^\(?${TS}\)?\s*[-–—:]?\s+(.*)$`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match)
      return { start: clockSeconds(match[1]!), title: stripMarkup(match[2]!) || undefined };
  }
  const trailing = new RegExp(String.raw`^(.*?)\s*[[(]${TS}[\])]\s*$`).exec(text);
  if (trailing)
    return { title: stripMarkup(trailing[1]!) || undefined, start: clockSeconds(trailing[2]!) };
  return { title: stripMarkup(text) || undefined };
}

interface Block {
  lines: string[];
  speaker?: string;
  start?: number;
}

/**
 * Parses a wiki transcript body (frontmatter allowed) into segments and
 * chapters. Paragraphs without their own timestamp get a start interpolated
 * by word count between the surrounding timestamps (`estimatedStarts`).
 * Returns no segments when the file has no timestamps at all.
 */
export function parseWikiTranscript(markdown: string): WikiTranscript {
  const { body } = splitFrontmatter(markdown);
  const blocks: Block[] = [];
  const chapters: Array<{ title?: string; start?: number; firstBlock: number }> = [];
  let current: Block | undefined;
  let speaker: string | undefined;
  let pendingStart: number | undefined;

  const flush = () => {
    if (current && current.lines.some((line) => stripMarkup(line))) blocks.push(current);
    current = undefined;
  };
  const open = (start: number | undefined, firstLine: string) => {
    flush();
    current = { lines: [firstLine], speaker, start: start ?? pendingStart };
    pendingStart = undefined;
  };
  /** `**Name:** text` → sets the running speaker; ambiguous labels ("A / B") clear it. */
  const withLabel = (text: string): string => {
    const label = /^\*\*([^*]{1,80}?)\s*:?\s*\*\*\s*:?\s*(.*)$/.exec(text);
    if (!label) return text;
    const name = label[1]!.replace(/:$/, "").trim();
    if (looksLikePersonName(name)) {
      speaker = cleanPersonName(name);
      return label[2]!;
    }
    if (/[/&]|\band\b/.test(name)) {
      speaker = undefined;
      return label[2]!;
    }
    return text;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || line.startsWith(">") || /^#\s/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{2,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const { title, start } = parseHeading(heading[1]!.trim());
      chapters.push({ title, start, firstBlock: blocks.length });
      pendingStart = start;
      continue;
    }
    const stampOnly = new RegExp(String.raw`^[*_\x60]*[[(]?${TS}[\])]?[*_\x60]*$`).exec(line);
    if (stampOnly) {
      flush();
      const start = clockSeconds(stampOnly[1]!);
      const chapter = chapters.at(-1);
      if (chapter && chapter.start === undefined && chapter.firstBlock === blocks.length)
        chapter.start = start;
      pendingStart = start;
      continue;
    }
    const timed = new RegExp(String.raw`^\[${TS}\]\s*(.*)$`).exec(line);
    if (timed) {
      const text = withLabel(timed[2]!);
      open(clockSeconds(timed[1]!), text);
      continue;
    }
    if (/^\*\*[^*]{1,80}\*\*/.test(line)) {
      const before = speaker;
      const text = withLabel(line);
      if (text !== line || speaker !== before) {
        open(undefined, text);
        continue;
      }
    }
    if (!current) open(undefined, line);
    else current.lines.push(line);
  }
  flush();

  // Word positions and anchors (blocks with a known start).
  const texts = blocks.map((block) => stripMarkup(block.lines.join(" ")));
  const wordPos: number[] = [];
  let words = 0;
  for (const text of texts) {
    wordPos.push(words);
    words += text.split(" ").filter(Boolean).length;
  }
  const anchors: Array<{ index: number; time: number }> = [];
  // Wiki transcripts start with the video: an untimed opening paragraph starts at 0.
  if (
    blocks.length > 0 &&
    blocks[0]!.start === undefined &&
    blocks.some((b) => b.start !== undefined)
  )
    anchors.push({ index: 0, time: 0 });
  for (const [index, block] of blocks.entries()) {
    if (block.start === undefined) continue;
    const last = anchors.at(-1);
    if (!last || block.start >= last.time) anchors.push({ index, time: block.start });
  }
  if (anchors.length === 0) return { segments: [], chapters: [], estimatedStarts: false };

  const firstAnchor = anchors[0]!;
  const lastAnchor = anchors.at(-1)!;
  const spanWords = wordPos[lastAnchor.index]! - wordPos[firstAnchor.index]!;
  const spanTime = lastAnchor.time - firstAnchor.time;
  const secondsPerWord =
    spanWords > 0 && spanTime > 0 ? spanTime / spanWords : DEFAULT_SECONDS_PER_WORD;

  let estimatedStarts = false;
  let next = 0;
  const starts = blocks.map((block, index) => {
    if (block.start !== undefined) return block.start;
    estimatedStarts = true;
    if (index === 0 && anchors[0]?.index === 0) return anchors[0].time;
    while (next < anchors.length && anchors[next]!.index < index) next++;
    const before = anchors[next - 1];
    const after = anchors[next];
    const position = wordPos[index]!;
    if (before && after) {
      const ratio =
        (position - wordPos[before.index]!) /
        Math.max(1, wordPos[after.index]! - wordPos[before.index]!);
      return Math.round(before.time + ratio * (after.time - before.time));
    }
    if (before)
      return Math.round(before.time + (position - wordPos[before.index]!) * secondsPerWord);
    return Math.max(
      0,
      Math.round(after!.time - (wordPos[after!.index]! - position) * secondsPerWord),
    );
  });

  const segments = blocks
    .map((block, index) => ({
      ...(block.speaker ? { speaker: block.speaker } : {}),
      start: starts[index]!,
      text: texts[index]!,
    }))
    .filter((segment) => segment.text);
  const chapterList = chapters.flatMap((chapter) => {
    const start =
      chapter.start ??
      (chapter.firstBlock < blocks.length ? starts[chapter.firstBlock] : undefined);
    return chapter.title && start !== undefined ? [{ title: chapter.title, start }] : [];
  });
  return { segments, chapters: chapterList, estimatedStarts };
}

/** Reads and parses the wiki transcript of an entry → unified transcript, or `undefined` if it has no timestamps. */
export async function readWikiTranscript(
  sync: WikiSync,
  entry: WikiEntry,
  createdAt: string,
): Promise<TranscriptInput | undefined> {
  const markdown = await readFile(path.join(sync.dir, entry.path), "utf8");
  const parsed = parseWikiTranscript(markdown);
  if (parsed.segments.length === 0) return undefined;
  return {
    source: "patrykwajs-wiki",
    timebase: "youtube",
    sourceUrl: wikiFileUrl(sync.head, entry.path),
    createdAt,
    segments: parsed.segments,
    chapters: parsed.chapters,
    extra: {
      wikiCommit: sync.head,
      wikiPath: entry.path,
      ...(parsed.estimatedStarts ? { estimatedStarts: true } : {}),
    },
  };
}
