/**
 * After the Python transcriber succeeded: validate its output with the core
 * schema, save it through core (which also sets `transcriptSource` /
 * `transcriptTimebase` on the episode), then clean up the work dir.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../../core/errors";
import { formatIssues, Transcript, type Episode } from "../../core/schema";
import { writeTranscript } from "../../core/transcripts";
import type { TranscriberJob } from "./job";

/** Reads and validates the transcriber output; `ValidationError` (with one line per issue) otherwise. */
export async function readTranscriberOutput(file: string): Promise<Transcript> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw new ValidationError(`transcriber output ${file} is missing or not JSON`, [
      (error as Error).message,
    ]);
  }
  const parsed = Transcript.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      `transcriber output ${file} is not a valid transcript`,
      formatIssues(parsed.error),
    );
  }
  if (parsed.data.source !== "whisper-local") {
    throw new ValidationError(`transcriber output has source '${parsed.data.source}'`, [
      "expected 'whisper-local'",
    ]);
  }
  if (parsed.data.segments.length === 0) {
    throw new ValidationError("transcriber output has no segments", [
      "the audio may be silent or the wrong file",
    ]);
  }
  return parsed.data;
}

/**
 * Removes the work dir once the transcript is saved. With `--keep-audio` the
 * diarization cache (+ the state that validates it) is kept beside the audio,
 * so re-transcribing with another `--model` skips diarization.
 */
export async function cleanupWorkDir(job: TranscriberJob): Promise<void> {
  if (job.keepAudio) {
    await rm(path.join(job.workDir, "asr"), { recursive: true, force: true });
    await rm(job.outputPath, { force: true });
  } else {
    await rm(job.workDir, { recursive: true, force: true });
  }
}

export async function saveTranscription(
  job: TranscriberJob,
  options: { now?: Date } = {},
): Promise<{ transcript: Transcript; episode: Episode }> {
  const transcript = await readTranscriberOutput(job.outputPath);
  const result = await writeTranscript(job.slug, transcript, options);
  await cleanupWorkDir(job);
  return result;
}
