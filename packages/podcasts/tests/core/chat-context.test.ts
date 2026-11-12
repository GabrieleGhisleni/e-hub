// Chat context of an episode: compacted transcript, prompt sections, and the not-found cases.

import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../../src/core/errors";
import {
  buildEpisodeChatContext,
  compactTranscript,
  formatChatTimestamp,
} from "../../src/core/chat-context";
import { writeTranscript } from "../../src/core/transcripts";
import { seedEpisode, useTempDirs } from "../helpers";

useTempDirs();

const transcript = {
  source: "lex-official" as const,
  timebase: "youtube" as const,
  createdAt: "2026-11-09T00:00:00.000Z",
  chapters: [{ title: "Introduzione", start: 0 }],
  segments: [
    { speaker: "Host", start: 0, text: "Benvenuti" },
    { speaker: "Host", start: 5, text: "  alla   puntata " },
    { speaker: "Guest", start: 12, text: "Grazie a voi." },
    { speaker: "Guest", start: 20, text: "" },
    { speaker: "Host", start: 3725, text: "Torniamo alla matematica" },
  ],
};

describe("formatChatTimestamp", () => {
  it("uses mm:ss under an hour and h:mm:ss from one hour on", () => {
    expect(formatChatTimestamp(0)).toBe("00:00");
    expect(formatChatTimestamp(754.9)).toBe("12:34");
    expect(formatChatTimestamp(3599)).toBe("59:59");
    expect(formatChatTimestamp(3600)).toBe("1:00:00");
    expect(formatChatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("compactTranscript", () => {
  it("merges consecutive same-speaker segments into one line per turn", () => {
    expect(compactTranscript(transcript.segments)).toEqual([
      "[00:00] Host: Benvenuti alla puntata",
      "[00:12] Guest: Grazie a voi.",
      "[1:02:05] Host: Torniamo alla matematica",
    ]);
  });

  it("merges speakerless segments only within 75 seconds", () => {
    const lines = compactTranscript([
      { start: 0, text: "uno" },
      { start: 60, text: "due" },
      { start: 100, text: "tre" },
    ]);
    expect(lines).toEqual(["[00:00] uno due", "[01:40] tre"]);
  });
});

describe("buildEpisodeChatContext", () => {
  it("builds the Italian prompt with metadata, summary, notes, chapters and the transcript between delimiters", async () => {
    const slug = "demo-show-first-episode";
    await seedEpisode({
      slug,
      publishedAt: "2026-10-01",
      summary: ["Il punto principale"],
      notes: "Una nota personale",
      transcriptSource: "lex-official",
      transcriptTimebase: "youtube",
    });
    await writeTranscript(slug, transcript);

    const context = await buildEpisodeChatContext(slug);

    expect(context.title).toBe("First episode");
    expect(context.system).toContain("- Titolo: First episode");
    expect(context.system).toContain("- Show: Demo Show");
    expect(context.system).toContain("- Ospiti: Guest Person");
    expect(context.system).toContain("- Data di pubblicazione: 2026-10-01");
    expect(context.system).toContain("## Punti chiave (dalla scheda dell'episodio)");
    expect(context.system).toContain("- Il punto principale");
    expect(context.system).toContain("Una nota personale");
    expect(context.system).toContain("[00:00] Introduzione");
    expect(context.system).toContain("=== INIZIO TRASCRIZIONE ===\n[00:00] Host: Benvenuti alla puntata\n");
    expect(context.system).toMatch(/\[1:02:05\] Host: Torniamo alla matematica\n=== FINE TRASCRIZIONE ===$/);
    expect(context.tokens).toBeGreaterThan(0);
  });

  it("throws NotFoundError when the episode does not exist", async () => {
    await expect(buildEpisodeChatContext("demo-show-missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the episode has no local transcript", async () => {
    await seedEpisode({ slug: "demo-show-no-transcript" });
    await expect(buildEpisodeChatContext("demo-show-no-transcript")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects an invalid slug before touching the disk", async () => {
    await expect(buildEpisodeChatContext("../etc")).rejects.toBeInstanceOf(ValidationError);
  });
});
