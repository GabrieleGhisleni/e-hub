/**
 * Transcription through Groq (`whisper-large-v3-turbo`), replacing the local Python/uv transcriber (docs/hosting.md).
 *
 * Audio: yt-dlp on the YouTube video, else the feed MP3. `ffmpeg` re-encodes it mono, 16 kHz, 32 kbps (about 14 MB an
 * hour) and, when the result is over the 25 MB upload limit of Groq, cuts it into parts. Each part is one API call;
 * finished parts are cached in the work dir, so a run that stops resumes. Groq returns no speakers: segments have none.
 *
 * Everything outside (HTTP, processes, sleeping) is injected, so the tests touch neither Groq nor ffmpeg.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Transcript } from "../../core/schema";
import type { TranscriberJob } from "./job";

export const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** Groq accepts 25 MB per file; stay below it. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/** Length of one part when the audio has to be split: 32 kbps ≈ 4 KB/s, so 5400 s ≈ 21.6 MB. */
export const PART_SECONDS = 5400;
const MAX_ATTEMPTS = 5;

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (command: string, args: string[]) => Promise<ExecResult>;

export const nodeExec: Exec = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "ENOENT" ? new DependencyError(`${command} not found on PATH`) : error,
      ),
    );
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });

/** A program or the API key is missing: exit code 5 of the transcriber ("expected failure"). */
export class DependencyError extends Error {}
/** No audio could be fetched: exit code 4. */
export class AudioError extends Error {}

export interface GroqDeps {
  fetch: typeof fetch;
  exec: Exec;
  apiKey: string | undefined;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface GroqSegment {
  start: number;
  end?: number;
  text: string;
}

async function ok(exec: Exec, command: string, args: string[], what: string): Promise<ExecResult> {
  const result = await exec(command, args);
  if (result.code !== 0) {
    throw new AudioError(`${what} failed: ${result.stderr.trim().slice(-400) || `exit ${result.code}`}`);
  }
  return result;
}

async function fetchSource(job: TranscriberJob, deps: GroqDeps): Promise<{ file: string; url: string; source: "youtube" | "feed" }> {
  await mkdir(job.audioDir, { recursive: true });
  if (job.youtubeId) {
    const url = `https://www.youtube.com/watch?v=${job.youtubeId}`;
    const template = path.join(job.audioDir, `${job.slug}.%(ext)s`);
    deps.log(`downloading audio from ${url}`);
    await ok(deps.exec, "yt-dlp", ["-f", "bestaudio/best", "--no-playlist", "-o", template, url], "yt-dlp");
    const found = (await readdir(job.audioDir)).find(
      (n) => n.startsWith(`${job.slug}.`) && !n.endsWith(".part") && !n.endsWith(".mp3.tmp"),
    );
    if (!found) throw new AudioError("yt-dlp finished but left no audio file");
    return { file: path.join(job.audioDir, found), url, source: "youtube" };
  }
  if (!job.feed) throw new AudioError("the episode has neither a YouTube video nor a feed audio");
  deps.log(`downloading feed audio ${job.feed.url}`);
  const response = await deps.fetch(job.feed.url, { redirect: "follow" });
  if (!response.ok) throw new AudioError(`feed audio: HTTP ${response.status}`);
  const file = path.join(job.audioDir, `${job.slug}.feed`);
  await writeFile(file, new Uint8Array(await response.arrayBuffer()));
  return { file, url: job.feed.url, source: "feed" };
}

/** Re-encodes to mono 16 kHz 32 kbps MP3 and, when it is too big for one upload, cuts it into parts. */
export async function prepareParts(
  input: string,
  job: TranscriberJob,
  deps: GroqDeps,
): Promise<string[]> {
  const work = path.join(job.workDir, "audio");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const whole = path.join(work, "audio.mp3");
  const limit = job.limitSeconds ? ["-t", String(job.limitSeconds)] : [];
  await ok(
    deps.exec,
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, ...limit, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", whole],
    "ffmpeg",
  );
  if ((await stat(whole)).size <= MAX_UPLOAD_BYTES) return [whole];
  await ok(
    deps.exec,
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", whole, "-f", "segment", "-segment_time", String(PART_SECONDS), "-c", "copy", path.join(work, "part-%03d.mp3")],
    "ffmpeg (split)",
  );
  await rm(whole, { force: true });
  return (await readdir(work))
    .filter((n) => /^part-\d+\.mp3$/.test(n))
    .sort()
    .map((n) => path.join(work, n));
}

async function durationOf(file: string, deps: GroqDeps): Promise<number> {
  const out = await ok(
    deps.exec,
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    "ffprobe",
  );
  const seconds = Number.parseFloat(out.stdout.trim());
  if (!Number.isFinite(seconds)) throw new AudioError(`ffprobe gave no duration for ${file}`);
  return seconds;
}

async function transcribePart(file: string, job: TranscriberJob, deps: GroqDeps): Promise<GroqSegment[]> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bytes = new Uint8Array(await readFile(file));
  for (let attempt = 1; ; attempt += 1) {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(file));
    form.set("model", job.model);
    form.set("response_format", "verbose_json");
    form.set("temperature", "0");
    form.set("language", "en");
    if (job.prompt) form.set("prompt", job.prompt.slice(0, 800));
    const response = await deps.fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}` },
      body: form,
    });
    if (response.ok) {
      const body = (await response.json()) as { segments?: { start?: number; end?: number; text?: string }[] };
      return (body.segments ?? [])
        .filter((s) => typeof s.start === "number" && typeof s.text === "string")
        .map((s) => ({ start: s.start as number, end: s.end, text: (s.text as string).trim() }))
        .filter((s) => s.text !== "");
    }
    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt >= MAX_ATTEMPTS) {
      // The body of an API error never carries the key.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Groq: HTTP ${response.status} ${detail}`);
    }
    const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "");
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(60_000, 2000 * 2 ** attempt);
    deps.log(`Groq HTTP ${response.status}: waiting ${Math.round(waitMs / 1000)} s (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(waitMs);
  }
}

/**
 * The `runTranscriber` of `transcribeEpisode`: writes `job.outputPath` and returns 0, or returns a non-zero code
 * (4 audio not found, 5 missing program or key, 1 anything else) after logging why.
 */
export async function runGroqTranscriber(job: TranscriberJob, deps: GroqDeps): Promise<number> {
  try {
    if (!deps.apiKey) throw new DependencyError("GROQ_API_KEY is not set (put it in .env.local)");
    await mkdir(job.workDir, { recursive: true });
    const source = await fetchSource(job, deps);
    const parts = await prepareParts(source.file, job, deps);
    deps.log(`${parts.length} part(s) to transcribe with ${job.model}`);

    const cache = path.join(job.workDir, "asr");
    await mkdir(cache, { recursive: true });
    const segments: GroqSegment[] = [];
    let offset = 0;
    for (const [index, part] of parts.entries()) {
      const cached = path.join(cache, `${path.basename(part, ".mp3")}.json`);
      let result: GroqSegment[];
      try {
        result = JSON.parse(await readFile(cached, "utf8")) as GroqSegment[];
        deps.log(`part ${index + 1}/${parts.length}: cached`);
      } catch {
        deps.log(`part ${index + 1}/${parts.length}: transcribing`);
        result = await transcribePart(part, job, deps);
        await writeFile(cached, JSON.stringify(result));
      }
      for (const segment of result) {
        const start = Math.round((offset + segment.start) * 100) / 100;
        const end = typeof segment.end === "number" && segment.end >= segment.start
          ? Math.round((offset + segment.end) * 100) / 100
          : undefined;
        segments.push({ start, end, text: segment.text });
      }
      if (index < parts.length - 1) offset += await durationOf(part, deps);
    }
    if (segments.length === 0) throw new AudioError("Groq returned no text: the audio may be silent");

    const output: Transcript = {
      source: "whisper-local",
      timebase: source.source,
      audio: { source: source.source, url: source.url },
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
      segments,
      chapters: [],
      extra: { transcriber: { engine: "groq", model: job.model, parts: parts.length } },
    };
    await writeFile(job.outputPath, `${JSON.stringify(output, null, 2)}\n`);
    if (!job.keepAudio) await rm(source.file, { force: true });
    await rm(path.join(job.workDir, "audio"), { recursive: true, force: true });
    return 0;
  } catch (error) {
    deps.log(`error: ${(error as Error).message}`);
    if (error instanceof AudioError) return 4;
    if (error instanceof DependencyError) return 5;
    return 1;
  }
}
