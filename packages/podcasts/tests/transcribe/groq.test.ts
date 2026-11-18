import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Episode, Show, Transcript } from "../../src/core/schema";
import {
  type Exec,
  GROQ_TRANSCRIPTION_URL,
  MAX_UPLOAD_BYTES,
  PART_SECONDS,
  runGroqTranscriber,
} from "../../src/cli/transcribe/groq";
import { buildJob } from "../../src/cli/transcribe/job";
import { SHOW, episodeFixture, useTempDirs } from "../helpers";

useTempDirs();

function job(overrides: { youtubeId?: string | null } = {}) {
  const episode = Episode.parse(episodeFixture({ ...(overrides.youtubeId === null ? { youtubeId: undefined } : {}) }));
  const feed =
    overrides.youtubeId === null
      ? ({ item: { enclosureUrl: "https://cdn.example.com/ep.mp3", title: "First episode" }, matchedBy: "title" } as never)
      : undefined;
  return buildJob(Show.parse(SHOW), episode, feed);
}

/** Fake yt-dlp/ffmpeg/ffprobe: writes files of the size the test wants. */
function fakeExec(options: { wholeBytes?: number; partDurations?: number[] } = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const exec: Exec = async (command, args) => {
    calls.push({ command, args });
    if (command === "yt-dlp") {
      const template = args[args.indexOf("-o") + 1]!;
      await writeFile(template.replace("%(ext)s", "webm"), "audio");
    } else if (command === "ffmpeg" && !args.includes("segment")) {
      await writeFile(args.at(-1)!, new Uint8Array(options.wholeBytes ?? 1000));
    } else if (command === "ffmpeg") {
      const pattern = args.at(-1)!;
      for (let i = 0; i < (options.partDurations?.length ?? 2); i += 1) {
        await writeFile(pattern.replace("%03d", String(i).padStart(3, "0")), "part");
      }
    } else if (command === "ffprobe") {
      const index = Number(/part-(\d+)/.exec(args.at(-1)!)?.[1] ?? 0);
      return { code: 0, stdout: `${options.partDurations?.[index] ?? 100}\n`, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const verbose = (...segments: [number, string][]) =>
  Response.json({ segments: segments.map(([start, text]) => ({ start, text })) });

describe("Groq transcriber", () => {
  it("transcribes one part from YouTube audio and writes a valid transcript", async () => {
    const j = job();
    const { exec, calls } = fakeExec();
    const fetchMock = vi.fn(async () => verbose([0, " Hello there."], [3.5, "Second."], [5, "   "]));
    const code = await runGroqTranscriber(j, {
      fetch: fetchMock as unknown as typeof fetch,
      exec,
      apiKey: "gsk-test",
      log: () => {},
      now: () => new Date("2026-11-18T10:00:00Z"),
    });
    expect(code).toBe(0);
    const out = Transcript.parse(JSON.parse(await readFile(j.outputPath, "utf8")));
    expect(out.timebase).toBe("youtube");
    expect(out.segments).toEqual([
      { start: 0, text: "Hello there." },
      { start: 3.5, text: "Second." },
    ]);
    // Mono, 16 kHz, 32 kbps.
    const encode = calls.find((c) => c.command === "ffmpeg")!.args;
    expect(encode).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000", "-b:a", "32k"]));
    // The request: model, key in the header only.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GROQ_TRANSCRIPTION_URL);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gsk-test");
    expect((init.body as FormData).get("model")).toBe("whisper-large-v3-turbo");
    // The downloaded audio is removed afterwards.
    await expect(stat(path.join(j.audioDir, `${j.slug}.webm`))).rejects.toThrow();
  });

  it("splits audio over the upload limit and offsets the timestamps of later parts", async () => {
    const j = job();
    const { exec, calls } = fakeExec({ wholeBytes: MAX_UPLOAD_BYTES + 1, partDurations: [5400, 1200] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verbose([0, "one"], [10, "two"]))
      .mockResolvedValueOnce(verbose([2, "three"]));
    const code = await runGroqTranscriber(j, { fetch: fetchMock as unknown as typeof fetch, exec, apiKey: "k", log: () => {} });
    expect(code).toBe(0);
    const split = calls.find((c) => c.args.includes("segment"))!;
    expect(split.args[split.args.indexOf("-segment_time") + 1]).toBe(String(PART_SECONDS));
    const out = JSON.parse(await readFile(j.outputPath, "utf8")) as { segments: { start: number; text: string }[]; extra: { transcriber: { parts: number } } };
    expect(out.segments.map((s) => [s.start, s.text])).toEqual([[0, "one"], [10, "two"], [5402, "three"]]);
    expect(out.extra.transcriber.parts).toBe(2);
  });

  it("uses the feed audio when there is no YouTube video, and waits on a 429", async () => {
    const j = job({ youtubeId: null });
    const { exec } = fakeExec();
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://cdn.example.com/ep.mp3") return new Response(new Uint8Array([1, 2, 3]));
      return fetchMock.mock.calls.filter(([u]) => u === GROQ_TRANSCRIPTION_URL).length === 1
        ? new Response("slow down", { status: 429, headers: { "retry-after": "7" } })
        : verbose([0, "ok"]);
    });
    const code = await runGroqTranscriber(j, { fetch: fetchMock as unknown as typeof fetch, exec, apiKey: "k", log: () => {}, sleep });
    expect(code).toBe(0);
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(JSON.parse(await readFile(j.outputPath, "utf8")).timebase).toBe("feed");
  });

  it("resumes: a part already transcribed is not sent again", async () => {
    const j = job();
    await mkdir(path.join(j.workDir, "asr"), { recursive: true });
    await writeFile(path.join(j.workDir, "asr", "audio.json"), JSON.stringify([{ start: 1, text: "cached" }]));
    const fetchMock = vi.fn();
    const code = await runGroqTranscriber(j, { fetch: fetchMock as unknown as typeof fetch, exec: fakeExec().exec, apiKey: "k", log: () => {} });
    expect(code).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns expected failure codes: no key (5), no audio (4), API error (1)", async () => {
    const base = { fetch: vi.fn() as unknown as typeof fetch, log: () => {} };
    expect(await runGroqTranscriber(job(), { ...base, exec: fakeExec().exec, apiKey: undefined })).toBe(5);
    const failing: Exec = async (command) => ({ code: command === "yt-dlp" ? 1 : 0, stdout: "", stderr: "unavailable" });
    expect(await runGroqTranscriber(job(), { ...base, exec: failing, apiKey: "k" })).toBe(4);
    const down = vi.fn(async () => new Response("bad", { status: 400 }));
    expect(await runGroqTranscriber(job(), { ...base, fetch: down as unknown as typeof fetch, exec: fakeExec().exec, apiKey: "k" })).toBe(1);
  });
});
