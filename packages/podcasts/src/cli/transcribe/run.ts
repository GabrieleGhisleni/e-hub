/**
 * `pnpm transcribe <slug>` flow: episode + show from core → audio plan
 * (YouTube id, feed MP3 fallback) → Python transcriber (`uv run`) → validated
 * transcript saved through core. Dependencies are injectable for tests.
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { constants } from "node:os";
import path from "node:path";
import { AlreadyExistsError, NotFoundError } from "../../core/errors";
import type { Http } from "../../core/ingest/http";
import { REPO_ROOT } from "../../core/paths";
import type { Episode, Transcript } from "../../core/schema";
import { readEpisode, readShow } from "../../core/store";
import { resolveFeedAudio } from "./feed-audio";
import { saveTranscription } from "./finish";
import { buildJob, type TranscribeOptions, type TranscriberJob } from "./job";

export const TRANSCRIBER_DIR = path.join(REPO_ROOT, "transcriber");

/** Python exit codes for a clear, expected error (bad job, no audio, missing dependency, already running). */
const EXPECTED_FAILURES = new Set([2, 3, 4, 5]);

/** The Python side exited with a non-zero code; its own message is already on stderr. */
export class TranscriberFailedError extends Error {
  readonly exitCode: number;
  readonly workDir: string;

  constructor(exitCode: number, workDir: string) {
    super(
      exitCode === 130
        ? `interrupted; progress is cached in ${workDir} — run the same command again to resume`
        : EXPECTED_FAILURES.has(exitCode)
          ? `transcriber stopped (exit ${exitCode}): see the error above`
          : `transcriber failed (exit ${exitCode}); progress is cached in ${workDir} — fix the cause and run the same command again to resume`,
    );
    this.name = "TranscriberFailedError";
    this.exitCode = exitCode;
    this.workDir = workDir;
  }
}

export interface TranscribeDeps {
  http: Http;
  /** Runs the Python transcriber on a job; resolves with its exit code. */
  runTranscriber: (job: TranscriberJob) => Promise<number>;
  log: (line: string) => void;
  now?: () => Date;
}

export interface TranscribeResult {
  job: TranscriberJob;
  transcript: Transcript;
  episode: Episode;
}

export async function transcribeEpisode(
  slug: string,
  options: TranscribeOptions & { force?: boolean },
  deps: TranscribeDeps,
): Promise<TranscribeResult> {
  const episode = await readEpisode(slug);
  const show = await readShow(episode.show);
  if (episode.transcriptSource && !options.force) {
    throw new AlreadyExistsError(
      `'${slug}' already has a ${episode.transcriptSource} transcript (timebase ${episode.transcriptTimebase}); pass --force to replace it with a local Whisper one`,
    );
  }

  const feed = await resolveFeedAudio(show, episode, deps.http);
  if (feed.match) {
    deps.log(
      `feed fallback: "${feed.match.item.title}" (matched by ${feed.match.matchedBy}) ${feed.match.item.enclosureUrl}`,
    );
  } else {
    deps.log(`feed fallback: none (${feed.reason})`);
  }
  if (!episode.youtubeId && !feed.match) {
    throw new NotFoundError(
      `no audio source for '${slug}': the episode has no youtubeId and ${feed.reason}`,
    );
  }

  const job = buildJob(show, episode, feed.match, options);
  await mkdir(job.workDir, { recursive: true });
  await rm(job.outputPath, { force: true }); // never pick up a stale result of an earlier run
  deps.log(
    `transcribing ${slug}: model ${job.model}, ${job.numSpeakers} speakers, diarizer ${job.diarizer}` +
      (job.limitSeconds ? `, first ${job.limitSeconds / 60} min only` : "") +
      (job.keepAudio ? ", keeping the audio" : ""),
  );
  const code = await deps.runTranscriber(job);
  if (code !== 0) throw new TranscriberFailedError(code, job.workDir);
  const saved = await saveTranscription(job, { now: deps.now?.() });
  return { job, ...saved };
}

/**
 * Launches `uv run --project transcriber python -m epod_transcriber -` with the
 * job on stdin; progress streams to our stdout/stderr. SIGINT/SIGTERM/SIGHUP
 * are forwarded so stopping `pnpm transcribe` stops the Python process too
 * (finished chunks stay cached).
 */
export function spawnTranscriber(job: TranscriberJob): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "uv",
      ["run", "--project", TRANSCRIBER_DIR, "--frozen", "python", "-m", "epod_transcriber", "-"],
      {
        cwd: REPO_ROOT,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      },
    );
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    for (const signal of signals) process.on(signal, forward);
    const done = () => {
      for (const signal of signals) process.off(signal, forward);
    };
    child.on("error", (error: NodeJS.ErrnoException) => {
      done();
      reject(
        error.code === "ENOENT"
          ? new Error(
              "uv not found on PATH (needed for the Python transcriber: https://docs.astral.sh/uv/)",
            )
          : error,
      );
    });
    child.on("close", (code, signal) => {
      done();
      resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
    child.stdin.on("error", () => {}); // the child may exit before reading the job
    child.stdin.end(JSON.stringify(job));
  });
}
