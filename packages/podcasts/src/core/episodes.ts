/**
 * Episode creation and duplicate detection (Node only). Used by ingest
 * (phase 4: `pnpm episode add`, the local "Aggiungi da URL" form).
 */
import { rm } from "node:fs/promises";
import { DuplicateEpisodeError, ValidationError } from "./errors";
import { z } from "zod";
import {
  Episode,
  IsoDate,
  Transcript,
  formatIssues,
  normalizeTags,
  type TranscriptInput,
} from "./schema";
import { assertSlug, files } from "./paths";
import { generateEpisodeSlug } from "./slug";
import {
  listEpisodeSlugs,
  listEpisodes,
  readEpisode,
  readShow,
  withLock,
  writeEpisode,
  writeTranscriptFile,
} from "./store";
import { findMatchingEpisode, type EpisodeMatch } from "./urls";

export interface CreateEpisodeInput {
  /** Slug of an existing show. */
  show: string;
  title: string;
  /** Original link the episode is added from. */
  url: string;
  guests?: string[];
  number?: number;
  youtubeId?: string;
  /** `YYYY-MM-DD`. */
  publishedAt?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
  /** `--added-at` (initial import only): `YYYY-MM-DD` (→ midnight UTC), ISO datetime or Date. Default: now. */
  addedAt?: string | Date;
  /** Explicit slug (must be valid and free). Default: generated `<show>-<title>`. */
  slug?: string;
  /** Transcript to store with the episode; sets `transcriptSource`/`transcriptTimebase`. */
  transcript?: TranscriptInput;
}

/** Normalises an `--added-at` value to an ISO UTC datetime. Throws `ValidationError`. */
export function normalizeAddedAt(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ValidationError("invalid addedAt date");
    return value.toISOString();
  }
  const text = value.trim();
  if (IsoDate.safeParse(text).success) return `${text}T00:00:00.000Z`;
  if (z.iso.datetime({ offset: true }).safeParse(text).success) return new Date(text).toISOString();
  throw new ValidationError(`invalid addedAt '${value}'`, [
    "expected YYYY-MM-DD or an ISO 8601 datetime",
  ]);
}

/** Existing episode with the same `youtubeId` (also extracted from URLs) or the same normalised URL, if any. */
export async function findEpisodeByUrlOrYoutubeId(query: {
  url?: string;
  youtubeId?: string;
}): Promise<EpisodeMatch<Episode> | undefined> {
  return findMatchingEpisode(await listEpisodes(), query);
}

/**
 * Creates `data/episodes/<slug>.json` (and the transcript, if given):
 * checks the show exists (`NotFoundError`), rejects duplicates by URL /
 * YouTube id (`DuplicateEpisodeError` with `existingSlug`), generates a unique
 * slug per DESIGN.md §13, sets `addedAt` (now or `input.addedAt`) and
 * validates everything before writing anything (`ValidationError`).
 * Content (summary/notes/conversations) is added later with `saveEpisode`.
 */
export async function createEpisode(
  input: CreateEpisodeInput,
  options: { now?: Date } = {},
): Promise<Episode> {
  return withLock("episodes:create", async () => {
    const now = options.now ?? new Date();
    await readShow(input.show);

    const duplicate = await findEpisodeByUrlOrYoutubeId({
      url: input.url,
      youtubeId: input.youtubeId,
    });
    if (duplicate) {
      throw new DuplicateEpisodeError(
        duplicate.episode.slug,
        duplicate.matchedBy === "youtubeId" ? "same YouTube id" : "same URL",
      );
    }

    const taken = new Set(await listEpisodeSlugs());
    let slug: string;
    if (input.slug !== undefined) {
      slug = assertSlug(input.slug, "episode slug");
      if (taken.has(slug)) throw new ValidationError(`episode slug '${slug}' is already taken`);
    } else {
      slug = generateEpisodeSlug(input.show, input.title, (candidate) => taken.has(candidate));
    }

    let transcript: Transcript | undefined;
    if (input.transcript !== undefined) {
      const parsedTranscript = Transcript.safeParse(input.transcript);
      if (!parsedTranscript.success)
        throw new ValidationError("invalid transcript", formatIssues(parsedTranscript.error));
      transcript = parsedTranscript.data;
    }

    const addedAt =
      input.addedAt === undefined ? now.toISOString() : normalizeAddedAt(input.addedAt);
    const candidate = {
      slug,
      title: input.title,
      guests: [...new Set((input.guests ?? []).map((guest) => guest.trim()).filter(Boolean))],
      show: input.show,
      number: input.number,
      url: input.url,
      youtubeId: input.youtubeId,
      publishedAt: input.publishedAt,
      addedAt,
      updatedAt: now.toISOString(),
      transcriptSource: transcript?.source,
      transcriptTimebase: transcript?.timebase,
      tags: normalizeTags(input.tags ?? []),
      summary: [],
      notes: "",
      extra: input.extra ?? {},
    };
    const parsed = Episode.safeParse(candidate);
    if (!parsed.success) throw new ValidationError("invalid episode", formatIssues(parsed.error));

    if (transcript) await writeTranscriptFile(slug, transcript);
    return writeEpisode(parsed.data, { now });
  });
}

/**
 * Removes an episode: `data/episodes/<slug>.json` plus its conversations and
 * local transcript files (`NotFoundError` if the episode does not exist).
 * Notes written on the episode live in `packages/notes` and are left alone.
 */
export async function deleteEpisode(slug: string): Promise<{ slug: string; title: string }> {
  assertSlug(slug, "episode slug");
  return withLock(`episode:${slug}`, async () => {
    const episode = await readEpisode(slug);
    // The episode file goes last: if anything fails midway the episode is still listed and can be retried.
    await rm(files.conversations(slug), { force: true });
    await rm(files.transcript(slug), { force: true });
    await rm(files.episode(slug));
    return { slug, title: episode.title };
  });
}
