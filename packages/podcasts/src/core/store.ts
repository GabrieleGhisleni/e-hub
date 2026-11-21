/**
 * Storage (Node only): read / list / write shows, episodes, conversations and
 * transcripts as JSON files under the data dir. Everything is validated on
 * read and on write; slugs are validated before they become paths; writes are
 * atomic and produce stable JSON (schema key order, `extra` sorted).
 *
 * Prefer the higher-level helpers (episodes.ts, shows.ts, save.ts,
 * transcripts.ts) over the raw writers here.
 */
import { currentUserId, listDir, removeFile, tryFileBatch } from "@ehub/store";
import path from "node:path";
import type { z } from "zod";
import { NotFoundError, ValidationError } from "./errors";
import { readJsonIfExists, sortKeysDeep, writeJsonAtomic } from "./json-file";
import { assertSlug, dirs, files } from "./paths";
import {
  ConversationsFile,
  Episode,
  Show,
  Transcript,
  formatIssues,
  type EpisodeInput,
  type ShowInput,
  type TranscriptInput,
} from "./schema";

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(`invalid ${what}`, formatIssues(result.error));
  return result.data;
}

/** Sorts the keys of every `extra` record (top level and inside arrays of objects) for stable diffs. */
function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value !== null && typeof value === "object") {
    const record = { ...(value as Record<string, unknown>) };
    if ("extra" in record) record.extra = sortKeysDeep(record.extra);
    return record as T;
  }
  return value;
}

async function readEntity<S extends z.ZodType>(
  schema: S,
  filePath: string,
  what: string,
): Promise<z.output<S> | undefined> {
  const raw = await readJsonIfExists(filePath);
  if (raw === undefined) return undefined;
  return parseOrThrow(schema, raw, `${what} (${filePath})`);
}

/** Slugs of the `*.json` files in a data subdirectory (invalid names ignored), sorted. */
async function listSlugs(dir: string): Promise<string[]> {
  const names = (await listDir(dir)).filter((e) => !e.isDirectory).map((e) => e.name);
  return names
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => path.basename(name, ".json"))
    .filter((slug) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
    .sort();
}

function checkFileName(slug: string, entitySlug: string, what: string): void {
  if (slug !== entitySlug)
    throw new ValidationError(`${what} file '${slug}.json' contains slug '${entitySlug}'`);
}

// ---------------------------------------------------------------------------
// In-process lock

const locks = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after any previous call with the same key has settled, so
 * read-modify-write sequences on one episode never interleave inside a
 * process (the local server can receive concurrent requests). Across
 * processes the `updatedAt` version check is the guard.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  key = `${currentUserId() ?? ""}:${key}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => {});
  locks.set(key, settled);
  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Shows

export async function readShowIfExists(slug: string): Promise<Show | undefined> {
  const show = await readEntity(Show, files.show(slug), `show '${slug}'`);
  if (show) checkFileName(slug, show.slug, "show");
  return show;
}

export async function readShow(slug: string): Promise<Show> {
  const show = await readShowIfExists(slug);
  if (!show) throw new NotFoundError(`show '${slug}' not found`);
  return show;
}

export async function listShowSlugs(): Promise<string[]> {
  return listSlugs(dirs.shows());
}

export async function listShows(): Promise<Show[]> {
  return Promise.all((await listShowSlugs()).map(readShow));
}

/** Validates and writes `data/shows/<slug>.json` (create or replace). */
export async function writeShow(input: ShowInput): Promise<Show> {
  const show = canonical(parseOrThrow(Show, input, "show"));
  await writeJsonAtomic(files.show(show.slug), show);
  return show;
}

// ---------------------------------------------------------------------------
// Episodes

export async function readEpisodeIfExists(slug: string): Promise<Episode | undefined> {
  const episode = await readEntity(Episode, files.episode(slug), `episode '${slug}'`);
  if (episode) checkFileName(slug, episode.slug, "episode");
  return episode;
}

export async function readEpisode(slug: string): Promise<Episode> {
  const episode = await readEpisodeIfExists(slug);
  if (!episode) throw new NotFoundError(`episode '${slug}' not found`);
  return episode;
}

export async function listEpisodeSlugs(): Promise<string[]> {
  return listSlugs(dirs.episodes());
}

/** All episodes, newest `addedAt` first (the list order of DESIGN.md §8.3). */
export async function listEpisodes(): Promise<Episode[]> {
  const episodes = await Promise.all((await listEpisodeSlugs()).map(readEpisode));
  return episodes.sort((a, b) =>
    a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : a.slug.localeCompare(b.slug),
  );
}

/**
 * A strictly increasing `updatedAt`: now, or 1 ms after `previous` if the
 * clock has not moved past it (two saves in the same millisecond must still
 * produce different versions).
 */
export function nextUpdatedAt(previous: string | undefined, now: Date = new Date()): string {
  const previousMs = previous === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previous);
  return new Date(Math.max(now.getTime(), previousMs + 1)).toISOString();
}

/**
 * Validates and writes `data/episodes/<slug>.json`, always setting a fresh
 * `updatedAt` (now, or strictly greater than the one on disk); any
 * `updatedAt` in `input` is ignored. Low level: no version check, no
 * transcript guard — use `saveEpisode` for user/agent content.
 */
export async function writeEpisode(
  input: Omit<EpisodeInput, "updatedAt"> & { updatedAt?: string },
  options: { now?: Date } = {},
): Promise<Episode> {
  const slug = assertSlug(input.slug, "episode slug");
  const onDisk = (await readJsonIfExists(files.episode(slug))) as
    | { updatedAt?: unknown }
    | undefined;
  const previous =
    typeof onDisk?.updatedAt === "string" && !Number.isNaN(Date.parse(onDisk.updatedAt))
      ? onDisk.updatedAt
      : undefined;
  const episode = canonical(
    parseOrThrow(Episode, { ...input, updatedAt: nextUpdatedAt(previous, options.now) }, "episode"),
  );
  await writeJsonAtomic(files.episode(slug), episode);
  return episode;
}

// ---------------------------------------------------------------------------
// Conversations

/** Conversations of an episode, oldest first; `[]` if the file does not exist. */
export async function readConversations(slug: string): Promise<ConversationsFile> {
  return (
    (await readEntity(
      ConversationsFile,
      files.conversations(slug),
      `conversations of '${slug}'`,
    )) ?? []
  );
}

/** Validates and writes `data/conversations/<slug>.json`. Low level: use `saveEpisode` to add conversations. */
export async function writeConversations(
  slug: string,
  conversations: ConversationsFile,
): Promise<ConversationsFile> {
  const parsed = parseOrThrow(ConversationsFile, conversations, `conversations of '${slug}'`);
  await writeJsonAtomic(files.conversations(slug), parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Transcripts (local only, gitignored)

export async function readTranscriptIfExists(slug: string): Promise<Transcript | undefined> {
  return readEntity(Transcript, files.transcript(slug), `transcript of '${slug}'`);
}

export async function readTranscript(slug: string): Promise<Transcript> {
  const transcript = await readTranscriptIfExists(slug);
  if (!transcript) throw new NotFoundError(`no local transcript for '${slug}'`);
  return transcript;
}

/** Validates and writes `data/transcripts/<slug>.json` only. Use `writeTranscript` (transcripts.ts) to also update the episode. */
export async function writeTranscriptFile(
  slug: string,
  input: TranscriptInput,
): Promise<Transcript> {
  const transcript = canonical(parseOrThrow(Transcript, input, `transcript of '${slug}'`));
  await writeJsonAtomic(files.transcript(slug), transcript);
  return transcript;
}

/** Updates the transcript and its episode metadata together on the hosted store. */
export async function setEpisodeTranscript(episode: Episode, transcript?: Transcript): Promise<Episode> {
  const updated = Episode.parse({
    ...episode,
    transcriptSource: transcript?.source,
    transcriptTimebase: transcript?.timebase,
    updatedAt: nextUpdatedAt(episode.updatedAt),
  });
  if (await tryFileBatch([
    { file: files.episode(episode.slug), content: JSON.stringify(updated) },
    { file: files.transcript(episode.slug), content: transcript && JSON.stringify(transcript) },
  ])) return updated;

  const previous = await readTranscriptIfExists(episode.slug);
  const write = async (value?: Transcript) => value
    ? writeTranscriptFile(episode.slug, value)
    : removeFile(files.transcript(episode.slug));
  await write(transcript);
  try {
    return await writeEpisode(updated, { now: new Date(updated.updatedAt) });
  } catch (error) {
    await write(previous);
    throw error;
  }
}
