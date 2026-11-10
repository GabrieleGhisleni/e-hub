/**
 * Local transcripts (Node only): write a transcript and keep the episode's
 * `transcriptSource` / `transcriptTimebase` in sync (ingest, phase 4;
 * transcriber, phase 8), and speaker correction (local UI, phase 7).
 */
import type { Episode, Transcript, TranscriptInput } from "./schema";
import { renameSpeakers, type SpeakerRange } from "./speakers";
import { readEpisode, readTranscript, withLock, writeEpisode, writeTranscriptFile } from "./store";

/**
 * Validates and writes `data/transcripts/<slug>.json` (replacing any previous
 * one) for an existing episode, then sets the episode's `transcriptSource` and
 * `transcriptTimebase` from it (the episode file — and its `updatedAt` — is
 * only rewritten if they change).
 */
export async function writeTranscript(
  slug: string,
  input: TranscriptInput,
  options: { now?: Date } = {},
): Promise<{ transcript: Transcript; episode: Episode }> {
  return withLock(`episode:${slug}`, async () => {
    let episode = await readEpisode(slug);
    const transcript = await writeTranscriptFile(slug, input);
    if (
      episode.transcriptSource !== transcript.source ||
      episode.transcriptTimebase !== transcript.timebase
    ) {
      episode = await writeEpisode(
        {
          ...episode,
          transcriptSource: transcript.source,
          transcriptTimebase: transcript.timebase,
        },
        options,
      );
    }
    return { transcript, episode };
  });
}

/**
 * Renames/swaps speakers in the local transcript (see `renameSpeakers`) and
 * writes it back. Does not touch the episode file. `NotFoundError` if there is
 * no local transcript; `ValidationError` for unknown speakers/empty names.
 */
export async function correctTranscriptSpeakers(
  slug: string,
  mapping: Readonly<Record<string, string>>,
  range: SpeakerRange = {},
): Promise<Transcript> {
  return withLock(`episode:${slug}`, async () => {
    const transcript = await readTranscript(slug);
    return writeTranscriptFile(slug, renameSpeakers(transcript, mapping, range));
  });
}
