/**
 * Compact markdown export of a local transcript for an agent (DESIGN.md §4.4).
 * Shared by `pnpm transcript export` and the local server ("Copia per l'agente").
 *
 * Format: header (title, show, guests, links, timebase), chapters as `##`,
 * consecutive segments of the same speaker merged into one paragraph that starts
 * with `**Speaker** [HH:MM:SS]`. Transcripts without speakers are split into
 * paragraphs of about `PARAGRAPH_SECONDS`, each starting with `[HH:MM:SS]`.
 * The transcript guard treats labels, timestamps and headings as transparent.
 */
import { NotFoundError } from "./errors";
import type { Episode, Show, Transcript } from "./schema";
import { readEpisode, readShowIfExists, readTranscriptIfExists } from "./store";

/** Target length of a paragraph in transcripts without speakers. */
export const PARAGRAPH_SECONDS = 75;

/** `HH:MM:SS` (hours at least two digits). */
export function formatExportTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

interface Paragraph {
  speaker?: string;
  start: number;
  texts: string[];
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pure renderer (tests, and callers that already hold the data). */
export function renderTranscriptMarkdown(
  episode: Pick<Episode, "title" | "guests" | "url" | "youtubeId">,
  show: Pick<Show, "name"> | undefined,
  transcript: Pick<Transcript, "segments" | "chapters" | "timebase" | "source">,
): string {
  const lines: string[] = [`# ${episode.title}`, ""];
  if (show) lines.push(`- Show: ${show.name}`);
  if (episode.guests.length > 0) lines.push(`- Guests: ${episode.guests.join(", ")}`);
  lines.push(`- Original: ${episode.url}`);
  if (episode.youtubeId)
    lines.push(`- YouTube: https://www.youtube.com/watch?v=${episode.youtubeId}`);
  lines.push(`- Transcript source: ${transcript.source}`);
  lines.push(`- Timebase: ${transcript.timebase}`);
  if (transcript.timebase === "feed") {
    lines.push(
      "",
      "> Note: timestamps refer to the podcast feed audio (different intro and ads); they do not match the YouTube video.",
    );
  }
  lines.push("");

  const chapters = [...transcript.chapters].sort((a, b) => a.start - b.start);
  let paragraph: Paragraph | undefined;
  const flush = () => {
    if (!paragraph) return;
    const label = paragraph.speaker ? `**${paragraph.speaker}** ` : "";
    lines.push(
      `${label}[${formatExportTimestamp(paragraph.start)}] ${paragraph.texts.join(" ")}`,
      "",
    );
    paragraph = undefined;
  };

  for (const segment of transcript.segments) {
    while (chapters.length > 0 && segment.start >= chapters[0]!.start) {
      flush();
      lines.push(`## ${clean(chapters.shift()!.title)}`, "");
    }
    const text = clean(segment.text);
    if (!text) continue;
    const sameSpeaker =
      paragraph !== undefined &&
      paragraph.speaker === segment.speaker &&
      (segment.speaker !== undefined || segment.start - paragraph.start < PARAGRAPH_SECONDS);
    if (sameSpeaker) paragraph!.texts.push(text);
    else {
      flush();
      paragraph = { speaker: segment.speaker, start: segment.start, texts: [text] };
    }
  }
  flush();
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** Reads the episode, its show and its local transcript and renders the export. */
export async function exportTranscriptMarkdown(slug: string): Promise<string> {
  const episode = await readEpisode(slug);
  const transcript = await readTranscriptIfExists(slug);
  if (!transcript) {
    throw new NotFoundError(
      `episode '${slug}' has no local transcript (run: pnpm transcribe ${slug})`,
    );
  }
  const show = await readShowIfExists(episode.show);
  return renderTranscriptMarkdown(episode, show, transcript);
}
