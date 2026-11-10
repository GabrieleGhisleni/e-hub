/**
 * Test helpers: temp data/public dirs, synthetic fixtures. Fixtures are
 * synthetic (made-up words from a seeded generator): no third-party text.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { DATA_DIR_ENV, PUBLIC_DIR_ENV } from "../src/core/paths";
import type { EpisodeInput, ShowInput, Transcript } from "../src/core/schema";
import { writeEpisode, writeShow } from "../src/core/store";

export interface TempDirs {
  root: string;
  data: string;
  public: string;
}

/** Registers beforeEach/afterEach hooks that point core at fresh temp dirs. Returns a live handle. */
export function useTempDirs(): TempDirs {
  const dirs: TempDirs = { root: "", data: "", public: "" };
  beforeEach(async () => {
    dirs.root = await mkdtemp(path.join(tmpdir(), "e-podcasts-test-"));
    dirs.data = path.join(dirs.root, "data");
    dirs.public = path.join(dirs.root, "public");
    process.env[DATA_DIR_ENV] = dirs.data;
    process.env[PUBLIC_DIR_ENV] = dirs.public;
  });
  afterEach(async () => {
    delete process.env[DATA_DIR_ENV];
    delete process.env[PUBLIC_DIR_ENV];
    await rm(dirs.root, { recursive: true, force: true });
  });
  return dirs;
}

/** All file names under `dir`, recursively (relative paths, sorted). */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

// ---------------------------------------------------------------------------
// Synthetic text

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = [
  "ka",
  "lo",
  "mi",
  "ner",
  "tu",
  "va",
  "zo",
  "pri",
  "sel",
  "dor",
  "fu",
  "gan",
  "hil",
  "jo",
  "wex",
  "qui",
];

/** A vocabulary of made-up words (never real English, so test prose cannot collide with it). */
export function vocabulary(size = 2000, seed = 1): string[] {
  const random = rng(seed);
  const words = new Set<string>();
  while (words.size < size) {
    const length = 2 + Math.floor(random() * 3);
    let word = "";
    for (let i = 0; i < length; i++) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
    words.add(word);
  }
  return [...words];
}

/** `count` synthetic words. */
export function syntheticWords(count: number, seed = 7): string[] {
  const vocab = vocabulary();
  const random = rng(seed);
  return Array.from({ length: count }, () => vocab[Math.floor(random() * vocab.length)]!);
}

/** Joins words into prose with capitals and punctuation every few words. */
export function toProse(words: readonly string[], seed = 3): string {
  const random = rng(seed);
  let text = "";
  let sentenceStart = true;
  for (const word of words) {
    text += (text ? " " : "") + (sentenceStart ? word[0]!.toUpperCase() + word.slice(1) : word);
    sentenceStart = false;
    const roll = random();
    if (roll < 0.08) {
      text += ".";
      sentenceStart = true;
    } else if (roll < 0.14) text += ",";
  }
  return `${text}.`;
}

/**
 * A synthetic transcript: `totalWords` words split into segments of 8–40
 * words, alternating between two speakers in runs, with chapters.
 */
export function syntheticTranscript(
  totalWords: number,
  seed = 7,
): { transcript: Transcript; words: string[] } {
  const words = syntheticWords(totalWords, seed);
  const random = rng(seed + 1);
  const segments: Transcript["segments"] = [];
  let i = 0;
  let speaker = 0;
  let time = 0;
  while (i < words.length) {
    const length = 8 + Math.floor(random() * 33);
    const chunk = words.slice(i, i + length);
    segments.push({
      speaker: speaker === 0 ? "Host Person" : "Guest Person",
      start: time,
      text: toProse(chunk, i),
    });
    time += Math.round(chunk.length / 2.5);
    i += length;
    if (random() < 0.4) speaker = 1 - speaker;
  }
  const chapters = [
    { title: "Introduction", start: 0 },
    { title: "Middle part", start: Math.round(time / 2) },
  ];
  return {
    words,
    transcript: {
      source: "lex-official",
      timebase: "youtube",
      createdAt: "2026-11-09T00:00:00.000Z",
      segments,
      chapters,
      extra: {},
    },
  };
}

function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/**
 * Minimal re-implementation of the §4.4 compact markdown export (the real one
 * comes in phase 7): header, chapters as `##`, consecutive same-speaker
 * segments merged into paragraphs prefixed by `**Speaker** [HH:MM:SS]`.
 */
export function compactMarkdownExport(transcript: Transcript, title = "Synthetic episode"): string {
  const lines = [`# ${title}`, "", "- Guests: Guest Person", "- Timebase: youtube", ""];
  const chapters = [...transcript.chapters];
  let paragraph: { speaker: string; start: number; texts: string[] } | undefined;
  const flush = () => {
    if (paragraph)
      lines.push(
        `**${paragraph.speaker}** [${formatTimestamp(paragraph.start)}] ${paragraph.texts.join(" ")}`,
        "",
      );
    paragraph = undefined;
  };
  for (const segment of transcript.segments) {
    if (chapters[0] && segment.start >= chapters[0].start) {
      flush();
      lines.push(`## ${chapters.shift()!.title}`, "");
    }
    const speaker = segment.speaker ?? "Speaker";
    if (paragraph && paragraph.speaker === speaker) paragraph.texts.push(segment.text);
    else {
      flush();
      paragraph = { speaker, start: segment.start, texts: [segment.text] };
    }
  }
  flush();
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fixture entities

export const SHOW: ShowInput = {
  slug: "demo-show",
  name: "Demo Show",
  host: "Host Person",
  links: { website: "https://example.com/" },
};

export function episodeFixture(overrides: Partial<EpisodeInput> = {}): EpisodeInput {
  return {
    slug: "demo-show-first-episode",
    title: "First episode",
    guests: ["Guest Person"],
    show: "demo-show",
    url: "https://example.com/episodes/1",
    youtubeId: "abcdefghijk",
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: ["sleep"],
    summary: ["A first point."],
    notes: "Original notes.",
    extra: {},
    ...overrides,
  };
}

/** Writes the demo show and one episode; returns the episode as stored. */
export async function seedEpisode(overrides: Partial<EpisodeInput> = {}) {
  await writeShow(SHOW);
  return writeEpisode(episodeFixture(overrides), { now: new Date("2026-01-01T00:00:00.000Z") });
}
