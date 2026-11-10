import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/core/errors";
import type { Transcript } from "../../src/core/schema";
import { writeTranscript } from "../../src/core/transcripts";
import { buildTranscriptIndex, redactTranscriptExcerpts } from "../../src/core/transcript-guard";
import {
  exportTranscriptMarkdown,
  formatExportTimestamp,
  renderTranscriptMarkdown,
} from "../../src/core/transcript-export";
import { seedEpisode, syntheticTranscript, useTempDirs } from "../helpers";

const episode = {
  title: "A title",
  guests: ["Ada Example", "Grace Sample"],
  url: "https://example.com/e/1",
  youtubeId: "abcdefghijk",
};

const base: Pick<Transcript, "timebase" | "source" | "chapters"> = {
  timebase: "youtube",
  source: "lex-official",
  chapters: [],
};

describe("formatExportTimestamp", () => {
  it("formats HH:MM:SS", () => {
    expect(formatExportTimestamp(0)).toBe("00:00:00");
    expect(formatExportTimestamp(5025.9)).toBe("01:23:45");
    expect(formatExportTimestamp(100 * 3600)).toBe("100:00:00");
  });
});

describe("renderTranscriptMarkdown", () => {
  it("writes the header with links and timebase", () => {
    const md = renderTranscriptMarkdown(episode, { name: "Demo Show" }, { ...base, segments: [] });
    expect(md).toContain("# A title");
    expect(md).toContain("- Show: Demo Show");
    expect(md).toContain("- Guests: Ada Example, Grace Sample");
    expect(md).toContain("- Original: https://example.com/e/1");
    expect(md).toContain("- YouTube: https://www.youtube.com/watch?v=abcdefghijk");
    expect(md).toContain("- Timebase: youtube");
    expect(md).not.toContain("do not match");
  });

  it("adds a note when the timebase is feed", () => {
    const md = renderTranscriptMarkdown(episode, undefined, {
      ...base,
      timebase: "feed",
      segments: [],
    });
    expect(md).toContain("- Timebase: feed");
    expect(md).toMatch(/do not match the YouTube video/);
  });

  it("merges consecutive segments of the same speaker and starts chapters with ##", () => {
    const md = renderTranscriptMarkdown(episode, undefined, {
      ...base,
      chapters: [
        { title: "Intro", start: 0 },
        { title: "Second", start: 3700 },
      ],
      segments: [
        { speaker: "Lex", start: 0, text: "Hello there." },
        { speaker: "Lex", start: 5, text: "Welcome  back." },
        { speaker: "Guest", start: 10, text: "Thanks." },
        { speaker: "Guest", start: 3725, text: "Later words." },
      ],
    });
    expect(md).toContain("## Intro\n\n**Lex** [00:00:00] Hello there. Welcome back.\n");
    expect(md).toContain("**Guest** [00:00:10] Thanks.\n");
    // The chapter boundary splits the Guest paragraph.
    expect(md).toContain("## Second\n\n**Guest** [01:02:05] Later words.");
  });

  it("splits transcripts without speakers into timestamped paragraphs", () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({
      start: i * 20,
      text: `line ${i}`,
    }));
    const md = renderTranscriptMarkdown(episode, undefined, { ...base, segments });
    const paragraphs = md.split("\n").filter((line) => line.startsWith("["));
    expect(paragraphs).toEqual([
      "[00:00:00] line 0 line 1 line 2 line 3",
      "[00:01:20] line 4 line 5 line 6 line 7",
      "[00:02:40] line 8 line 9",
    ]);
  });

  it("round-trips through the transcript guard (pasting the export is fully redacted)", () => {
    const { transcript } = syntheticTranscript(3000);
    const md = renderTranscriptMarkdown(episode, undefined, transcript);
    const result = redactTranscriptExcerpts(buildTranscriptIndex(transcript), md);
    expect(result.removed).toBeGreaterThan(0);
  });
});

describe("exportTranscriptMarkdown", () => {
  useTempDirs();

  it("exports a stored transcript with the show name", async () => {
    await seedEpisode();
    const { transcript } = syntheticTranscript(400);
    await writeTranscript("demo-show-first-episode", transcript);
    const md = await exportTranscriptMarkdown("demo-show-first-episode");
    expect(md).toContain("# First episode");
    expect(md).toContain("- Show: Demo Show");
    expect(md).toContain("**Host Person** [00:00:00]");
  });

  it("fails clearly without a local transcript", async () => {
    await seedEpisode();
    await expect(exportTranscriptMarkdown("demo-show-first-episode")).rejects.toThrow(
      /no local transcript.*pnpm transcribe demo-show-first-episode/,
    );
    await expect(exportTranscriptMarkdown("demo-show-first-episode")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
