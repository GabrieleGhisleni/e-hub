/**
 * `pnpm transcribe <slug> [flags]` — Whisper transcription of an episode through Groq (docs/hosting.md; needs
 * GROQ_API_KEY, `ffmpeg`, and `yt-dlp` for YouTube audio). Audio: yt-dlp on the episode's YouTube video (timebase
 * youtube), else the show feed's MP3 (timebase feed). Resumable: finished parts are cached and a re-run skips them.
 *
 * Exit codes: 0 ok, 1 transcriber failed/unexpected, 2 usage, 3 invalid
 * output, 4 episode/show/audio not found, 8 transcript already present
 * (use --force), 130 interrupted.
 */
import { parseArgs } from "node:util";
import { CoreError, EXIT_CODES, exitCodeFor } from "../core/errors";
import { createHttp } from "../core/ingest/http";
import { files } from "../core/paths";
import { DIARIZERS, type Diarizer, type TranscribeOptions } from "./transcribe/job";
import { nodeExec, runGroqTranscriber } from "./transcribe/groq";
import {
  transcribeEpisode,
  TranscriberFailedError,
  type TranscribeResult,
} from "./transcribe/run";

const USAGE = `Usage:
  pnpm transcribe <slug> [options]

Options:
  --model <name>         Groq model (default whisper-large-v3-turbo)
  --keep-audio           keep the downloaded audio in data/audio for a later re-run
  --limit-minutes <n>    transcribe only the first n minutes (testing)
  --force                replace an existing transcript (e.g. an official one)

Groq returns no speakers: segments have none (the speakers dialog can still label them). A 2 h episode is a few
minutes of API time; stopping it keeps the finished parts and the same command resumes.`;

class UsageError extends Error {}

function positiveNumber(
  value: string | undefined,
  flag: string,
  integer = true,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    throw new UsageError(`${flag} must be a positive ${integer ? "integer" : "number"}`);
  }
  return n;
}

function parse(argv: string[]): { slug: string; options: TranscribeOptions & { force: boolean } } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "num-speakers": { type: "string" },
      diarizer: { type: "string" },
      "keep-audio": { type: "boolean", default: false },
      "limit-minutes": { type: "string" },
      threads: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  const [slug, ...rest] = positionals;
  if (!slug || rest.length > 0) throw new UsageError("expected exactly one <slug>");
  const diarizer = values.diarizer ?? "diarize";
  if (!(DIARIZERS as readonly string[]).includes(diarizer)) {
    throw new UsageError(`--diarizer must be one of: ${DIARIZERS.join(", ")}`);
  }
  const numSpeakers = positiveNumber(values["num-speakers"], "--num-speakers");
  if (numSpeakers !== undefined && numSpeakers > 20)
    throw new UsageError("--num-speakers must be ≤ 20");
  if (values.model !== undefined && !values.model.trim()) throw new UsageError("--model is empty");
  return {
    slug,
    options: {
      model: values.model?.trim(),
      numSpeakers,
      diarizer: diarizer as Diarizer,
      keepAudio: values["keep-audio"] ?? false,
      limitMinutes: positiveNumber(values["limit-minutes"], "--limit-minutes", false),
      cpuThreads: positiveNumber(values.threads, "--threads"),
      force: values.force ?? false,
    },
  };
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function describe(result: TranscribeResult, elapsedMs: number): string {
  const { transcript, episode, job } = result;
  const words = new Map<string, number>();
  for (const segment of transcript.segments) {
    const speaker = segment.speaker ?? "(no speaker)";
    words.set(
      speaker,
      (words.get(speaker) ?? 0) + segment.text.split(/\s+/).filter(Boolean).length,
    );
  }
  const info = (transcript.extra.transcriber ?? {}) as { hostDetection?: string };
  return [
    `Transcribed ${episode.slug} (whisper-local, timebase ${transcript.timebase})`,
    `  audio: ${transcript.audio?.source} ${transcript.audio?.url}`,
    `  segments: ${transcript.segments.length}; words per speaker: ${[...words].map(([s, n]) => `${s} ${n}`).join(", ")}`,
    `  speaker names by heuristic (${info.hostDetection ?? "first-speaker"}): if host and guest look swapped, fix them in the local UI`,
    `  saved: ${files.transcript(episode.slug)}; episode transcriptSource=${episode.transcriptSource}, transcriptTimebase=${episode.transcriptTimebase}`,
    job.keepAudio ? `  audio kept in ${job.audioDir}` : "  audio deleted",
    `  total time: ${formatDuration(elapsedMs)}`,
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return EXIT_CODES.ok;
  }
  const started = Date.now();
  try {
    const { slug, options } = parse(argv);
    const result = await transcribeEpisode(slug, options, {
      http: createHttp(),
      runTranscriber: (job) =>
        runGroqTranscriber(job, {
          fetch,
          exec: nodeExec,
          apiKey: process.env.GROQ_API_KEY,
          log: (line) => console.error(`[transcribe] ${line}`),
        }),
      log: (line) => console.error(`[transcribe] ${line}`),
    });
    console.log(describe(result, Date.now() - started));
    return EXIT_CODES.ok;
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`error: ${(error as Error).message}\n\n${USAGE}`);
      return EXIT_CODES.usage;
    }
    if (error instanceof TranscriberFailedError) {
      console.error(`error: ${error.message}`);
      return error.exitCode === 130 ? 130 : EXIT_CODES.unexpected;
    }
    if (error instanceof CoreError) {
      console.error(`error (${error.code}): ${error.describe()}`);
      return exitCodeFor(error);
    }
    console.error(error instanceof Error ? `error: ${error.message}` : error);
    return EXIT_CODES.unexpected;
  }
}

process.exitCode = await main(process.argv.slice(2));
