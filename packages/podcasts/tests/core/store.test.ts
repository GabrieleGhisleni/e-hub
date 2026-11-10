import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createEpisode,
  findEpisodeByUrlOrYoutubeId,
  normalizeAddedAt,
} from "../../src/core/episodes";
import {
  AlreadyExistsError,
  DuplicateEpisodeError,
  NotFoundError,
  ValidationError,
} from "../../src/core/errors";
import { toStableJson, writeFileAtomic, writeJsonAtomic } from "../../src/core/json-file";
import { DATA_DIR_ENV, dataDir, files } from "../../src/core/paths";
import { createShow, findShowByYoutubeAuthorUrl, saveShowImage } from "../../src/core/shows";
import { listSpeakers, renameSpeakers, swapSpeakers } from "../../src/core/speakers";
import {
  listEpisodes,
  nextUpdatedAt,
  readEpisode,
  readShow,
  readTranscript,
  writeShow,
} from "../../src/core/store";
import { correctTranscriptSpeakers, writeTranscript } from "../../src/core/transcripts";
import {
  SHOW,
  listFilesRecursive,
  seedEpisode,
  syntheticTranscript,
  useTempDirs,
} from "../helpers";

const dirs = useTempDirs();

describe("paths", () => {
  it("uses the env override and validates slugs before building paths", () => {
    expect(dataDir()).toBe(dirs.data);
    expect(process.env[DATA_DIR_ENV]).toBe(dirs.data);
    expect(files.episode("ok-slug")).toBe(path.join(dirs.data, "episodes", "ok-slug.json"));
    expect(() => files.episode("../../etc/passwd")).toThrow(ValidationError);
  });
});

describe("atomic, stable JSON writes", () => {
  it("leaves no temp files behind, on success or on failure", async () => {
    const target = path.join(dirs.data, "x", "file.json");
    await writeJsonAtomic(target, { a: 1 });
    await writeJsonAtomic(target, { a: 2 });
    expect(await listFilesRecursive(dirs.data)).toEqual(["x/file.json"]);
    expect(await readFile(target, "utf8")).toBe('{\n  "a": 2\n}\n');

    // Renaming onto a directory fails: the temp file must be cleaned up.
    const directoryTarget = path.join(dirs.data, "x", "dir.json");
    await mkdir(directoryTarget);
    await expect(writeFileAtomic(directoryTarget, "data")).rejects.toThrow();
    expect(await listFilesRecursive(dirs.data)).toEqual(["x/file.json"]);
  });

  it("formats with 2-space indent and trailing newline, extra keys sorted", async () => {
    expect(toStableJson({ b: [1, 2] })).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}\n');
    await writeShow({ ...SHOW, extra: { zeta: 1, alpha: { y: 1, x: 2 } } });
    const text = await readFile(files.show(SHOW.slug), "utf8");
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
    expect(text.indexOf('"x"')).toBeLessThan(text.indexOf('"y"'));
    expect(Object.keys(JSON.parse(text))).toEqual(["slug", "name", "host", "links", "extra"]);
  });
});

describe("store reads", () => {
  it("validates on read and reports the file", async () => {
    await mkdir(path.join(dirs.data, "episodes"), { recursive: true });
    await writeFile(files.episode("broken"), JSON.stringify({ slug: "broken", title: "" }));
    const error = await readEpisode("broken").catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain("broken.json");
    await writeFile(files.episode("bad-json"), "{");
    await expect(readEpisode("bad-json")).rejects.toBeInstanceOf(ValidationError);
    await expect(readEpisode("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists episodes newest addedAt first", async () => {
    await seedEpisode();
    await seedEpisode({
      slug: "demo-show-second",
      url: "https://example.com/2",
      youtubeId: undefined,
      addedAt: "2026-03-01T00:00:00.000Z",
    });
    expect((await listEpisodes()).map((episode) => episode.slug)).toEqual([
      "demo-show-second",
      "demo-show-first-episode",
    ]);
  });

  it("nextUpdatedAt is strictly increasing", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(nextUpdatedAt(undefined, now)).toBe("2026-01-01T00:00:00.000Z");
    expect(nextUpdatedAt("2026-01-01T00:00:00.000Z", now)).toBe("2026-01-01T00:00:00.001Z");
    expect(nextUpdatedAt("2025-01-01T00:00:00.000Z", now)).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("createEpisode / findEpisodeByUrlOrYoutubeId", () => {
  const now = new Date("2026-11-09T10:00:00.000Z");
  const base = {
    show: "demo-show",
    title: "#12 – Sleep, Dreams & Memory",
    url: "https://example.com/12",
  };

  it("generates the slug, sets addedAt/updatedAt and writes a valid episode", async () => {
    await writeShow(SHOW);
    const episode = await createEpisode(
      { ...base, guests: [" Guest A ", "Guest A"], number: 12, youtubeId: "abcdefghijk" },
      { now },
    );
    expect(episode).toMatchObject({
      slug: "demo-show-12-sleep-dreams-memory",
      guests: ["Guest A"],
      addedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      summary: [],
      notes: "",
      tags: [],
    });
    expect(await readEpisode(episode.slug)).toEqual(episode);
  });

  it("accepts --added-at dates", async () => {
    await writeShow(SHOW);
    const episode = await createEpisode({ ...base, addedAt: "2024-05-01" }, { now });
    expect(episode.addedAt).toBe("2024-05-01T00:00:00.000Z");
    expect(episode.updatedAt).toBe(now.toISOString());
    expect(normalizeAddedAt("2024-05-01T12:00:00+02:00")).toBe("2024-05-01T10:00:00.000Z");
    expect(() => normalizeAddedAt("2024-02-30")).toThrow(ValidationError);
    expect(() => normalizeAddedAt("yesterday")).toThrow(ValidationError);
  });

  it("makes slugs unique for same-titled episodes", async () => {
    await writeShow(SHOW);
    const a = await createEpisode({ ...base, url: "https://example.com/a" }, { now });
    const b = await createEpisode({ ...base, url: "https://example.com/b" }, { now });
    expect(b.slug).toBe(`${a.slug}-2`);
  });

  it("rejects duplicates by URL or YouTube id, and unknown shows", async () => {
    await writeShow(SHOW);
    await createEpisode({ ...base, youtubeId: "abcdefghijk" }, { now });
    const byUrl = await createEpisode({ ...base, url: "https://example.com/12/" }).catch((e) => e);
    expect(byUrl).toBeInstanceOf(DuplicateEpisodeError);
    expect(byUrl.existingSlug).toBe("demo-show-12-sleep-dreams-memory");
    await expect(
      createEpisode({ ...base, url: "https://youtu.be/abcdefghijk" }),
    ).rejects.toBeInstanceOf(DuplicateEpisodeError);
    expect(await findEpisodeByUrlOrYoutubeId({ youtubeId: "abcdefghijk" })).toMatchObject({
      matchedBy: "youtubeId",
    });
    expect(await findEpisodeByUrlOrYoutubeId({ url: "https://example.com/other" })).toBeUndefined();
    await expect(
      createEpisode({ ...base, show: "nope", url: "https://example.com/x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates everything before writing (invalid transcript → nothing written)", async () => {
    await writeShow(SHOW);
    const error = await createEpisode({
      ...base,
      transcript: {
        source: "whisper-local",
        timebase: "youtube",
        createdAt: now.toISOString(),
        segments: [],
      },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(await listFilesRecursive(path.join(dirs.data, "episodes"))).toEqual([]);
  });

  it("stores a transcript given at creation and sets source/timebase", async () => {
    await writeShow(SHOW);
    const { transcript } = syntheticTranscript(100);
    const episode = await createEpisode({ ...base, transcript }, { now });
    expect(episode).toMatchObject({
      transcriptSource: "lex-official",
      transcriptTimebase: "youtube",
    });
    expect((await readTranscript(episode.slug)).segments).toHaveLength(transcript.segments.length);
  });
});

describe("shows", () => {
  const png = () =>
    sharp({ create: { width: 800, height: 600, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();

  it("saveShowImage converts to a square 512 px webp in public/shows", async () => {
    const relative = await saveShowImage("demo-show", await png());
    expect(relative).toBe("shows/demo-show.webp");
    const meta = await sharp(path.join(dirs.public, relative)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    await expect(saveShowImage("demo-show", new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(saveShowImage("demo-show", "file:///etc/passwd")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("createShow writes the show with its image, refuses to overwrite by default", async () => {
    const show = await createShow(
      { ...SHOW, youtubeAuthorUrl: "https://www.youtube.com/@demo" },
      { imageSource: await png() },
    );
    expect(show.image).toBe("shows/demo-show.webp");
    expect(await readShow("demo-show")).toEqual(show);
    await expect(createShow(SHOW)).rejects.toBeInstanceOf(AlreadyExistsError);
    await expect(createShow({ ...SHOW, name: "" }, { overwrite: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await findShowByYoutubeAuthorUrl("https://youtube.com/@demo/"))?.slug).toBe(
      "demo-show",
    );
    expect(await findShowByYoutubeAuthorUrl("https://www.youtube.com/@other")).toBeUndefined();
  });
});

describe("transcripts and speakers", () => {
  it("writeTranscript stores the file and syncs the episode's source/timebase", async () => {
    const before = await seedEpisode();
    const { transcript } = syntheticTranscript(200);
    const { episode } = await writeTranscript(
      before.slug,
      { ...transcript, source: "patrykwajs-wiki" },
      { now: new Date("2026-02-01T00:00:00.000Z") },
    );
    expect(episode).toMatchObject({
      transcriptSource: "patrykwajs-wiki",
      transcriptTimebase: "youtube",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    // Same source/timebase again: the episode is not rewritten.
    const again = await writeTranscript(before.slug, { ...transcript, source: "patrykwajs-wiki" });
    expect(again.episode.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    await expect(writeTranscript("missing", transcript)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renames and swaps speakers, optionally in a time range", async () => {
    const transcript = {
      segments: [
        { speaker: "SPEAKER_0", start: 0, text: "a" },
        { speaker: "SPEAKER_1", start: 10, text: "b" },
        { speaker: "SPEAKER_0", start: 20, text: "c" },
        { start: 30, text: "d" },
      ],
    };
    expect(listSpeakers(transcript)).toEqual([
      { speaker: "SPEAKER_0", segments: 2, firstStart: 0 },
      { speaker: "SPEAKER_1", segments: 1, firstStart: 10 },
    ]);
    const swapped = swapSpeakers(transcript, "SPEAKER_0", "SPEAKER_1");
    expect(swapped.segments.map((segment) => segment.speaker)).toEqual([
      "SPEAKER_1",
      "SPEAKER_0",
      "SPEAKER_1",
      undefined,
    ]);
    const ranged = renameSpeakers(transcript, { SPEAKER_0: "Host" }, { from: 5 });
    expect(ranged.segments.map((segment) => segment.speaker)).toEqual([
      "SPEAKER_0",
      "SPEAKER_1",
      "Host",
      undefined,
    ]);
    expect(() => renameSpeakers(transcript, { NOBODY: "x" })).toThrow(ValidationError);
    expect(() => renameSpeakers(transcript, { SPEAKER_0: " " })).toThrow(ValidationError);
  });

  it("correctTranscriptSpeakers writes the local transcript only", async () => {
    const before = await seedEpisode();
    const { transcript } = syntheticTranscript(200);
    await writeTranscript(before.slug, transcript);
    const episodeBefore = await readEpisode(before.slug);
    await correctTranscriptSpeakers(before.slug, {
      "Host Person": "Guest Person",
      "Guest Person": "Host Person",
    });
    const after = await readTranscript(before.slug);
    expect(after.segments[0]!.speaker).toBe(
      transcript.segments[0]!.speaker === "Host Person" ? "Guest Person" : "Host Person",
    );
    expect(await readEpisode(before.slug)).toEqual(episodeBefore);
  });
});
