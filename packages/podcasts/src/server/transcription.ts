import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentUserId } from "@ehub/store";
import { nodeExec, runGroqTranscriber } from "../cli/transcribe/groq";
import { DEFAULT_MODEL, JOB_VERSION, type TranscriberJob } from "../cli/transcribe/job";
import { ValidationError } from "../core/errors";
import { Transcript, YoutubeId } from "../core/schema";
import { withLock } from "../core/store";

export async function transcribeWithGroq(
  episode: { title: string; youtubeId?: string },
  now: Date,
  progress?: (message: string) => void,
) {
  const videoId = YoutubeId.safeParse(episode.youtubeId);
  if (!videoId.success)
    throw new ValidationError("Per la trascrizione API serve un video YouTube.");
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ValidationError("Groq non è configurato sul server.");

  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([currentUserId(), videoId.data, episode.title, DEFAULT_MODEL, JOB_VERSION]),
    )
    .digest("hex");
  const workDir = path.join(
    process.env.E_PODCASTS_JOB_CACHE ?? tmpdir(),
    `ehub-transcribe-${cacheKey}`,
  );
  const job: TranscriberJob = {
    version: JOB_VERSION,
    slug: "episode",
    youtubeId: videoId.data,
    workDir,
    audioDir: path.join(workDir, "download"),
    outputPath: path.join(workDir, "result.json"),
    feed: null,
    prompt: episode.title,
    hostName: "",
    guestNames: [],
    numSpeakers: 2,
    model: DEFAULT_MODEL,
    cpuThreads: 8,
    diarizer: "diarize",
    keepAudio: false,
    limitSeconds: null,
    chunkSeconds: 600,
  };
  return withLock(`groq:${cacheKey}`, async () => {
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    try {
      const code = await runGroqTranscriber(job, {
        apiKey,
        fetch,
        exec: nodeExec,
        log: (line) => {
          const part = /^part (\d+)\/(\d+):/.exec(line);
          if (part) progress?.(`Groq · parte ${part[1]} di ${part[2]}`);
        },
        now: () => now,
      });
      if (code !== 0)
        throw new ValidationError(
          "Trascrizione Groq interrotta. Riprova per riprendere dalle parti completate.",
        );
      const result = Transcript.parse(JSON.parse(await readFile(job.outputPath, "utf8")));
      await rm(workDir, { recursive: true, force: true });
      return Transcript.parse({
        ...result,
        schemaVersion: 1,
        source: "api",
        extra: { ...result.extra, mode: "api", provider: "groq", model: job.model },
      });
    } finally {
      await rm(job.audioDir, { recursive: true, force: true });
      await rm(path.join(workDir, "audio"), { recursive: true, force: true });
    }
  });
}
