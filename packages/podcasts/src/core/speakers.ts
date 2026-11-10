/**
 * Speaker correction on a transcript (DESIGN.md §4.3, §8.5): rename or swap
 * speakers. Pure and isomorphic, so the local UI can preview a change; the
 * Node wrapper that writes the file is `correctTranscriptSpeakers` in
 * transcripts.ts.
 */
import { ValidationError } from "./errors";
import type { Transcript } from "./schema";

export interface SpeakerInfo {
  speaker: string;
  /** Number of segments attributed to this speaker. */
  segments: number;
  /** Start (seconds) of the first segment. */
  firstStart: number;
}

/** Distinct speakers in order of first appearance (segments without a speaker are ignored). */
export function listSpeakers(transcript: Pick<Transcript, "segments">): SpeakerInfo[] {
  const speakers = new Map<string, SpeakerInfo>();
  for (const segment of transcript.segments) {
    if (segment.speaker === undefined) continue;
    const info = speakers.get(segment.speaker);
    if (info) info.segments++;
    else
      speakers.set(segment.speaker, {
        speaker: segment.speaker,
        segments: 1,
        firstStart: segment.start,
      });
  }
  return [...speakers.values()];
}

export interface SpeakerRange {
  /** Only segments with `start >= from` (seconds). */
  from?: number;
  /** Only segments with `start < to` (seconds). */
  to?: number;
}

/**
 * Applies `mapping` (old name → new name) to every segment, all at once, so
 * `{A: "B", B: "A"}` swaps and `{SPEAKER_1: "Dario Amodei"}` renames.
 * Optionally limited to a time range (to fix a stretch the diarizer got
 * wrong). Every key must be an existing speaker and every value non-empty,
 * otherwise `ValidationError`. Returns a new transcript.
 */
export function renameSpeakers<T extends Pick<Transcript, "segments">>(
  transcript: T,
  mapping: Readonly<Record<string, string>>,
  range: SpeakerRange = {},
): T {
  const known = new Set(listSpeakers(transcript).map((info) => info.speaker));
  const problems: string[] = [];
  const cleaned = new Map<string, string>();
  for (const [from, to] of Object.entries(mapping)) {
    const name = to.trim();
    if (!known.has(from))
      problems.push(`unknown speaker '${from}' (known: ${[...known].join(", ") || "none"})`);
    if (!name) problems.push(`new name for '${from}' must not be empty`);
    if (name.length > 200) problems.push(`new name for '${from}' must be at most 200 characters`);
    cleaned.set(from, name);
  }
  if (problems.length > 0) throw new ValidationError("invalid speaker correction", problems);

  const inRange = (start: number) =>
    (range.from === undefined || start >= range.from) &&
    (range.to === undefined || start < range.to);
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => {
      const to = segment.speaker === undefined ? undefined : cleaned.get(segment.speaker);
      return to !== undefined && inRange(segment.start) ? { ...segment, speaker: to } : segment;
    }),
  };
}

/** Swaps two speakers (host ↔ guest). */
export function swapSpeakers<T extends Pick<Transcript, "segments">>(
  transcript: T,
  a: string,
  b: string,
  range: SpeakerRange = {},
): T {
  return renameSpeakers(transcript, { [a]: b, [b]: a }, range);
}
