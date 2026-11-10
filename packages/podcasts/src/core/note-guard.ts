/**
 * Guard for personal notes on an episode (written by the notes module, published with the site): the same rule as
 * summary and notes, at most 20 consecutive words copied from the local transcript. Node only.
 */
import { isValidSlug } from "./schema";
import { readTranscriptIfExists } from "./store";
import { buildTranscriptIndex, findTranscriptExcerpts } from "./transcript-guard";

/** Previews of the transcript excerpts found in `text` (empty: OK, or no local transcript). */
export async function findEpisodeNoteExcerpts(slug: string, text: string): Promise<string[]> {
  if (!isValidSlug(slug)) return [];
  const transcript = await readTranscriptIfExists(slug);
  if (!transcript) return [];
  return findTranscriptExcerpts(buildTranscriptIndex(transcript), text).map((span) => span.preview);
}
