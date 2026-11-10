import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AlreadyExistsError, NotFoundError, ValidationError } from "../../src/core/errors";
import type { Http } from "../../src/core/ingest/http";
import type { Episode, Show } from "../../src/core/schema";
import {
  readEpisode,
  readTranscriptIfExists,
  writeShow,
  writeTranscriptFile,
} from "../../src/core/store";
import {
  buildJob,
  buildPrompt,
  defaultNumSpeakers,
  type TranscriberJob,
} from "../../src/cli/transcribe/job";
import { TranscriberFailedError, transcribeEpisode } from "../../src/cli/transcribe/run";
import { SHOW, seedEpisode, useTempDirs } from "../helpers";

const dirs = useTempDirs();

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Demo</title>
<item><title>#7 – Guest Person: Old maps</title><pubDate>Thu, 09 Apr 2026 10:00:00 +0000</pubDate>
<enclosure url="https://cdn.example.com/demo_7.mp3" type="audio/mpeg" length="1"/></item>
</channel></rss>`;

const http: Http = {
  text: async () => FEED,
  textIfExists: async () => FEED,
  json: async () => ({}),
  bytes: async () => new Uint8Array(),
};

/** What the Python side writes: a valid whisper transcript for the job's audio choice. */
function fakeOutput(job: TranscriberJob, overrides: Record<string, unknown> = {}) {
  const source = job.youtubeId ? "youtube" : "feed";
  return {
    source: "whisper-local",
    timebase: source,
    audio: {
      source,
      url: job.youtubeId ? `https://www.youtube.com/watch?v=${job.youtubeId}` : job.feed!.url,
    },
    createdAt: "2026-11-10T10:00:00.000Z",
    segments: [
      { speaker: "Host Person", start: 0, text: "Kalo mivex dorantu." },
      { speaker: "Guest Person", start: 3.21, text: "Selva pri." },
    ],
    chapters: [],
    extra: { transcriber: { model: job.model, hostDetection: "first-speaker" } },
    ...overrides,
  };
}

function fakeRunner(write: (job: TranscriberJob) => unknown, code = 0) {
  return vi.fn(async (job: TranscriberJob) => {
    await mkdir(path.join(job.workDir, "asr"), { recursive: true });
    await writeFile(path.join(job.workDir, "asr", "chunk-000.json"), "{}");
    await writeFile(path.join(job.workDir, "diarization.json"), "{}");
    await writeFile(path.join(job.workDir, "state.json"), "{}");
    const output = write(job);
    if (output !== undefined) await writeFile(job.outputPath, JSON.stringify(output));
    return code;
  });
}

const deps = (runTranscriber: (job: TranscriberJob) => Promise<number>) => ({
  http,
  runTranscriber,
  log: () => {},
  now: () => new Date("2026-11-10T12:00:00.000Z"),
});

describe("job building", () => {
  const show = { ...SHOW, links: {}, extra: {} } as Show;

  it("defaults the speaker count to host + guests (2 if unknown)", () => {
    expect(defaultNumSpeakers([])).toBe(2);
    expect(defaultNumSpeakers(["A"])).toBe(2);
    expect(defaultNumSpeakers(["A", "B"])).toBe(3);
  });

  it("builds the Whisper prompt from show, host, guests and title", () => {
    const episode = { title: "#7 – Old maps & sails", guests: ["Ann Lee", "Bo Kim"] } as Episode;
    expect(buildPrompt(show, episode)).toBe(
      "Demo Show. A conversation between Host Person and Ann Lee and Bo Kim. Old maps & sails.",
    );
    expect(buildPrompt(show, { title: "Solo talk?", guests: [] } as unknown as Episode)).toBe(
      "Demo Show. Hosted by Host Person. Solo talk?",
    );
  });

  it("puts work and audio dirs under the data dir and maps the flags", async () => {
    const episode = await seedEpisode();
    const job = buildJob(show, episode, undefined, {
      limitMinutes: 3,
      keepAudio: true,
      model: "medium.en",
    });
    expect(job).toMatchObject({
      version: 1,
      slug: episode.slug,
      workDir: path.join(dirs.data, "cache", "transcribe", episode.slug),
      audioDir: path.join(dirs.data, "audio"),
      outputPath: path.join(dirs.data, "cache", "transcribe", episode.slug, "transcript.json"),
      youtubeId: "abcdefghijk",
      feed: null,
      hostName: "Host Person",
      guestNames: ["Guest Person"],
      numSpeakers: 2,
      model: "medium.en",
      cpuThreads: 8,
      diarizer: "diarize",
      keepAudio: true,
      limitSeconds: 180,
      chunkSeconds: 600,
    });
  });
});

describe("transcribeEpisode (fake Python side)", () => {
  async function seedWithFeed(overrides: Partial<Episode> = {}) {
    const episode = await seedEpisode({ number: 7, ...overrides });
    await writeShow({ ...SHOW, feedUrl: "https://example.com/feed.xml" });
    return episode;
  }

  it("validates and saves the transcript through core, then removes the work dir", async () => {
    const episode = await seedWithFeed();
    const run = fakeRunner((job) => fakeOutput(job));
    const result = await transcribeEpisode(episode.slug, {}, deps(run));

    expect(run).toHaveBeenCalledOnce();
    const job = run.mock.calls[0]![0];
    expect(job.feed).toEqual({
      url: "https://cdn.example.com/demo_7.mp3",
      title: "#7 – Guest Person: Old maps",
      matchedBy: "number",
    });
    expect(result.transcript.timebase).toBe("youtube");
    const stored = await readEpisode(episode.slug);
    expect(stored.transcriptSource).toBe("whisper-local");
    expect(stored.transcriptTimebase).toBe("youtube");
    expect((await readTranscriptIfExists(episode.slug))?.segments).toHaveLength(2);
    expect(await readdir(path.join(dirs.data, "cache", "transcribe"))).toEqual([]);
  });

  it("with --keep-audio keeps the diarization cache for a later re-run", async () => {
    const episode = await seedWithFeed();
    const run = fakeRunner((job) => fakeOutput(job));
    await transcribeEpisode(episode.slug, { keepAudio: true }, deps(run));
    const work = run.mock.calls[0]![0].workDir;
    expect((await readdir(work)).sort()).toEqual(["diarization.json", "state.json"]);
  });

  it("uses the feed MP3 when there is no YouTube id (timebase feed)", async () => {
    const episode = await seedWithFeed({ youtubeId: undefined });
    const run = fakeRunner((job) => fakeOutput(job));
    const result = await transcribeEpisode(episode.slug, {}, deps(run));
    expect(run.mock.calls[0]![0].youtubeId).toBeNull();
    expect(result.episode.transcriptTimebase).toBe("feed");
    expect(result.transcript.audio).toEqual({
      source: "feed",
      url: "https://cdn.example.com/demo_7.mp3",
    });
  });

  it("rejects invalid output without writing anything and keeps the caches", async () => {
    const episode = await seedWithFeed();
    const run = fakeRunner((job) => fakeOutput(job, { timebase: "feed" })); // audio says youtube
    await expect(transcribeEpisode(episode.slug, {}, deps(run))).rejects.toThrow(ValidationError);
    expect(await readTranscriptIfExists(episode.slug)).toBeUndefined();
    expect((await readEpisode(episode.slug)).transcriptSource).toBeUndefined();
    expect(await readdir(run.mock.calls[0]![0].workDir)).toContain("diarization.json");

    const empty = fakeRunner((job) => fakeOutput(job, { segments: [] }));
    await expect(transcribeEpisode(episode.slug, {}, deps(empty))).rejects.toThrow(/no segments/);
    const missing = fakeRunner(() => undefined);
    await expect(transcribeEpisode(episode.slug, {}, deps(missing))).rejects.toThrow(
      /missing or not JSON/,
    );
  });

  it("reports a failed or interrupted transcriber run, keeping the work dir for resume", async () => {
    const episode = await seedWithFeed();
    const failed = fakeRunner(() => undefined, 3);
    const error = await transcribeEpisode(episode.slug, {}, deps(failed)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscriberFailedError);
    expect((error as TranscriberFailedError).exitCode).toBe(3);
    expect(await readdir((error as TranscriberFailedError).workDir)).toContain("asr");
    const interrupted = fakeRunner(() => undefined, 130);
    await expect(transcribeEpisode(episode.slug, {}, deps(interrupted))).rejects.toThrow(/resume/);
  });

  it("refuses to replace an existing transcript unless forced", async () => {
    const episode = await seedWithFeed({
      transcriptSource: "lex-official",
      transcriptTimebase: "youtube",
    });
    await writeTranscriptFile(episode.slug, {
      source: "lex-official",
      timebase: "youtube",
      createdAt: "2026-01-01T00:00:00.000Z",
      segments: [{ start: 0, text: "x" }],
    });
    const run = fakeRunner((job) => fakeOutput(job));
    await expect(transcribeEpisode(episode.slug, {}, deps(run))).rejects.toThrow(
      AlreadyExistsError,
    );
    expect(run).not.toHaveBeenCalled();
    await transcribeEpisode(episode.slug, { force: true }, deps(run));
    expect((await readEpisode(episode.slug)).transcriptSource).toBe("whisper-local");
  });

  it("fails clearly when there is no audio source at all", async () => {
    const episode = await seedEpisode({ youtubeId: undefined }); // show without feedUrl
    const run = fakeRunner((job) => fakeOutput(job));
    await expect(transcribeEpisode(episode.slug, {}, deps(run))).rejects.toThrow(NotFoundError);
    await expect(transcribeEpisode(episode.slug, {}, deps(run))).rejects.toThrow(
      /no youtubeId and show 'demo-show' has no feedUrl/,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
