import { z } from "zod";
import { ValidationError } from "./errors";
import { HttpUrl, Transcript, YoutubeId, type TranscriptInput } from "./schema";
import { extractYoutubeId } from "./urls";

const Segments = z
  .array(
    z
      .object({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
        text: z.string().trim().min(1).max(20_000),
        speaker: z.string().trim().min(1).max(200).optional(),
      })
      .refine(({ start, end }) => end >= start, "Fine del segmento precedente all'inizio"),
  )
  .min(1)
  .max(50_000)
  .refine(
    (segments) => segments.every(({ start }, i) => i === 0 || start >= segments[i - 1]!.start),
    "I segmenti devono essere ordinati per tempo di inizio",
  );

export const AskChannelExport = z
  .object({
    video_id: YoutubeId,
    video_title: z.string().trim().min(1).max(500),
    video_url: HttpUrl,
    published_at: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
    segment_count: z.int().positive(),
    segments: Segments,
  })
  .refine((data) => data.segment_count === data.segments.length, "Numero di segmenti discordante")
  .refine(
    (data) => extractYoutubeId(data.video_url) === data.video_id,
    "URL e ID YouTube discordanti",
  );

export const LocalExport = z.object({
  videoId: YoutubeId,
  model: z.string().trim().min(1).max(100),
  result: z.object({ segments: Segments }),
});

export const TranscriptChoice = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({
    mode: z.literal("paste"),
    source: z.literal("askchannel"),
    data: AskChannelExport,
  }),
  z.strictObject({ mode: z.literal("local"), data: LocalExport }),
  z.strictObject({ mode: z.literal("api") }),
]);
export type TranscriptChoice = z.input<typeof TranscriptChoice>;

export function importTranscript(
  choice: Extract<z.output<typeof TranscriptChoice>, { mode: "paste" | "local" }>,
  youtubeId: string | undefined,
  now: Date,
): TranscriptInput {
  const videoId = choice.mode === "paste" ? choice.data.video_id : choice.data.videoId;
  if (videoId !== youtubeId)
    throw new ValidationError("La trascrizione appartiene a un altro video YouTube.");
  const common = {
    timebase: "youtube" as const,
    createdAt: now.toISOString(),
    schemaVersion: 1 as const,
  };
  return Transcript.parse(
    choice.mode === "paste"
      ? {
          ...common,
          source: "askchannel",
          sourceUrl: choice.data.video_url,
          segments: choice.data.segments,
          extra: {
            mode: "paste",
            parserVersion: 1,
            videoTitle: choice.data.video_title,
            publishedAt: choice.data.published_at,
          },
        }
      : {
          ...common,
          source: "whisper-local",
          audio: { source: "youtube", url: `https://www.youtube.com/watch?v=${videoId}` },
          segments: choice.data.result.segments,
          extra: { mode: "local", parserVersion: 1, model: choice.data.model },
        },
  );
}
