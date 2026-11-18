/**
 * The JSON job handed to the Python transcriber (`transcriber/src/epod_transcriber/job.py`
 * parses it; keep the two in sync).
 */
import path from "node:path";
import { dataDir } from "../../core/paths";
import type { Episode, Show } from "../../core/schema";
import type { FeedMatch } from "./feed-audio";

export const JOB_VERSION = 1;
/** Groq-hosted Whisper (docs/hosting.md). */
export const DEFAULT_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_CPU_THREADS = 8;
export const CHUNK_SECONDS = 600;
export const DIARIZERS = ["diarize", "pyannote"] as const;
export type Diarizer = (typeof DIARIZERS)[number];

export interface TranscribeOptions {
  model?: string;
  numSpeakers?: number;
  keepAudio?: boolean;
  diarizer?: Diarizer;
  limitMinutes?: number;
  cpuThreads?: number;
}

export interface TranscriberJob {
  version: typeof JOB_VERSION;
  slug: string;
  workDir: string;
  audioDir: string;
  outputPath: string;
  youtubeId: string | null;
  feed: { url: string; title: string; matchedBy: FeedMatch["matchedBy"] } | null;
  prompt: string;
  hostName: string;
  guestNames: string[];
  numSpeakers: number;
  model: string;
  cpuThreads: number;
  diarizer: Diarizer;
  keepAudio: boolean;
  limitSeconds: number | null;
  chunkSeconds: number;
}

/** Where the transcriber keeps its resumable caches and its output (gitignored). */
export function transcribeWorkDir(slug: string): string {
  return path.join(dataDir(), "cache", "transcribe", slug);
}

/** Downloaded/converted audio (gitignored, deleted after the run unless --keep-audio). */
export function audioDir(): string {
  return path.join(dataDir(), "audio");
}

/** DESIGN.md §7.4: 1 + number of guests, 2 when the guests are not known. */
export function defaultNumSpeakers(guests: readonly string[]): number {
  return guests.length > 0 ? 1 + guests.length : 2;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Whisper `initial_prompt`: show, host, guests and the title (proper nouns are
 * `small.en`'s weak point, DESIGN.md §7.3). A leading "#123 –" is dropped.
 */
export function buildPrompt(show: Show, episode: Episode): string {
  const title = episode.title.replace(/^#\d+\s*[–—-]\s*/, "").trim();
  const who =
    episode.guests.length > 0
      ? `A conversation between ${show.host} and ${joinNames(episode.guests)}.`
      : `Hosted by ${show.host}.`;
  return `${show.name}. ${who} ${title}${/[.!?]$/.test(title) ? "" : "."}`;
}

export function buildJob(
  show: Show,
  episode: Episode,
  feed: FeedMatch | undefined,
  options: TranscribeOptions = {},
): TranscriberJob {
  const workDir = transcribeWorkDir(episode.slug);
  return {
    version: JOB_VERSION,
    slug: episode.slug,
    workDir,
    audioDir: audioDir(),
    outputPath: path.join(workDir, "transcript.json"),
    youtubeId: episode.youtubeId ?? null,
    feed: feed
      ? { url: feed.item.enclosureUrl, title: feed.item.title, matchedBy: feed.matchedBy }
      : null,
    prompt: buildPrompt(show, episode),
    hostName: show.host,
    guestNames: [...episode.guests],
    numSpeakers: options.numSpeakers ?? defaultNumSpeakers(episode.guests),
    model: options.model ?? DEFAULT_MODEL,
    cpuThreads: options.cpuThreads ?? DEFAULT_CPU_THREADS,
    diarizer: options.diarizer ?? "diarize",
    keepAudio: options.keepAudio ?? false,
    limitSeconds: options.limitMinutes !== undefined ? options.limitMinutes * 60 : null,
    chunkSeconds: CHUNK_SECONDS,
  };
}
