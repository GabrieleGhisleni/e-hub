import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  TranscriptGuardError,
  ValidationError,
} from "../../src/core/errors";
import { saveEpisode } from "../../src/core/save";
import { readConversations, readEpisode, writeTranscriptFile } from "../../src/core/store";
import {
  MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT,
  TRANSCRIPT_EXCERPT_PLACEHOLDER,
} from "../../src/core/transcript-guard";
import {
  compactMarkdownExport,
  seedEpisode,
  syntheticTranscript,
  toProse,
  useTempDirs,
} from "../helpers";

const dirs = useTempDirs();
const SLUG = "demo-show-first-episode";
const later = (minutes: number) => new Date(Date.UTC(2026, 0, 2, 0, minutes));

describe("saveEpisode — validation", () => {
  it("saves a valid input", async () => {
    await seedEpisode();
    const result = await saveEpisode(
      SLUG,
      {
        summary: ["One.", "Two.", "Three."],
        notes: "# Notes\n\nNew.",
        tags: ["dopamine"],
        guests: ["Someone Else"],
      },
      { now: later(1) },
    );
    expect(result.written).toBe(true);
    expect(result.changedFields).toEqual(["summary", "notes", "tags", "guests"]);
    const stored = await readEpisode(SLUG);
    expect(stored).toMatchObject({
      summary: ["One.", "Two.", "Three."],
      notes: "# Notes\n\nNew.",
      tags: ["dopamine"],
      guests: ["Someone Else"],
    });
    expect(stored.updatedAt).toBe(later(1).toISOString());
  });

  it("rejects unknown keys and invalid values with clear messages, writing nothing", async () => {
    const before = await seedEpisode();
    const error = await saveEpisode(SLUG, {
      sumary: ["x"],
      tags: ["ok", "C++"],
      conversations: [{ markdown: "hi" }],
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const text = error.describe();
    expect(text).toContain('Unrecognized key: "sumary"');
    expect(text).toMatch(/tags\[1\]: tag must be lowercase/);
    expect(text).toMatch(/conversations\[0\]\.agent: /);
    expect(await readEpisode(SLUG)).toEqual(before);
  });

  it("rejects non-object input", async () => {
    await seedEpisode();
    await expect(saveEpisode(SLUG, ["summary"])).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unknown episode and an invalid slug", async () => {
    await expect(saveEpisode("missing-episode", { notes: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(saveEpisode("../etc/passwd", { notes: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("normalises and dedupes tags (trim, lowercase, spaces → hyphens)", async () => {
    await seedEpisode();
    await saveEpisode(SLUG, { tags: [" Sleep ", "sleep", "Machine Learning", "AI", "ai"] });
    expect((await readEpisode(SLUG)).tags).toEqual(["sleep", "machine-learning", "ai"]);
  });
});

describe("saveEpisode — merge semantics", () => {
  it("overwrites present fields and leaves absent ones unchanged", async () => {
    const before = await seedEpisode();
    await saveEpisode(SLUG, { notes: "Only notes changed." }, { now: later(1) });
    const after = await readEpisode(SLUG);
    expect(after.notes).toBe("Only notes changed.");
    expect(after.summary).toEqual(before.summary);
    expect(after.tags).toEqual(before.tags);
    expect(after.guests).toEqual(before.guests);
    expect(after.title).toBe(before.title);
    expect(after.addedAt).toBe(before.addedAt);
  });

  it("present empty values clear a field", async () => {
    await seedEpisode();
    await saveEpisode(SLUG, { summary: [], tags: [] });
    expect(await readEpisode(SLUG)).toMatchObject({ summary: [], tags: [] });
  });

  it("does not write when nothing changes", async () => {
    const before = await seedEpisode();
    const result = await saveEpisode(SLUG, { notes: before.notes, tags: before.tags });
    expect(result.written).toBe(false);
    expect(result.changedFields).toEqual([]);
    expect((await readEpisode(SLUG)).updatedAt).toBe(before.updatedAt);
  });

  it("appends conversations and does not duplicate them when the same input is saved twice", async () => {
    await seedEpisode();
    const input = {
      conversations: [
        {
          agent: "claude.ai",
          date: "2026-01-02",
          markdown: "**Me:** what about sleep?\r\n\r\n**Claude:** It matters.\n",
        },
        { agent: "chatgpt", markdown: "Another chat." },
      ],
    };
    const first = await saveEpisode(SLUG, input, { now: later(1) });
    expect(first.conversations).toEqual({ added: 2, skipped: 0, excerptsRemoved: 0 });
    const second = await saveEpisode(SLUG, input, { now: later(2) });
    expect(second.conversations).toEqual({ added: 0, skipped: 2, excerptsRemoved: 0 });
    expect(second.written).toBe(false);

    const third = await saveEpisode(
      SLUG,
      { conversations: [{ agent: "claude-code", markdown: "A third one." }] },
      { now: later(3) },
    );
    expect(third.conversations.added).toBe(1);
    const stored = await readConversations(SLUG);
    expect(stored.map((conversation) => conversation.agent)).toEqual([
      "claude.ai",
      "chatgpt",
      "claude-code",
    ]);
    expect(stored[0]).toEqual({
      date: "2026-01-02T00:00:00.000Z",
      agent: "claude.ai",
      markdown: "**Me:** what about sleep?\n\n**Claude:** It matters.",
    });
    expect(stored[1]!.date).toBe(later(1).toISOString());
  });

  it("dedupes repeated conversations within one input", async () => {
    await seedEpisode();
    const conversation = { agent: "claude.ai", markdown: "Same text." };
    const result = await saveEpisode(SLUG, { conversations: [conversation, conversation] });
    expect(result.conversations).toMatchObject({ added: 1, skipped: 1 });
  });

  it("always sets a strictly newer updatedAt on write", async () => {
    await seedEpisode();
    const sameInstant = new Date("2020-01-01T00:00:00.000Z"); // clock behind the file
    const a = await saveEpisode(SLUG, { notes: "a" }, { now: sameInstant });
    const b = await saveEpisode(SLUG, { notes: "b" }, { now: sameInstant });
    expect(a.episode.updatedAt > "2026-01-01T00:00:00.000Z").toBe(true);
    expect(b.episode.updatedAt > a.episode.updatedAt).toBe(true);
  });
});

describe("saveEpisode — version check", () => {
  it("accepts the current updatedAt and rejects a stale one", async () => {
    const before = await seedEpisode();
    const ok = await saveEpisode(
      SLUG,
      { notes: "first" },
      { expectedUpdatedAt: before.updatedAt, now: later(1) },
    );
    expect(ok.written).toBe(true);

    const error = await saveEpisode(
      SLUG,
      { notes: "second" },
      { expectedUpdatedAt: before.updatedAt },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.actualUpdatedAt).toBe(ok.episode.updatedAt);
    expect((await readEpisode(SLUG)).notes).toBe("first");
  });
});

describe("saveEpisode — transcript guard", () => {
  const { transcript, words } = syntheticTranscript(2000);
  const excerpt = (from: number, count: number) => toProse(words.slice(from, from + count), 5);

  it("removes transcript excerpts from conversations (also inside a §4.4 export) and reports them", async () => {
    await seedEpisode();
    await writeTranscriptFile(SLUG, transcript);
    const result = await saveEpisode(SLUG, {
      conversations: [
        { agent: "claude.ai", markdown: `I liked this: ${excerpt(200, 25)} What do you think?` },
        {
          agent: "claude-code",
          markdown: `> pnpm transcript export\n\n${compactMarkdownExport(transcript)}\n\nLet's talk.`,
        },
      ],
    });
    expect(result.transcriptChecked).toBe(true);
    expect(result.conversations).toEqual({ added: 2, skipped: 0, excerptsRemoved: 2 });
    const [first, second] = await readConversations(SLUG);
    expect(first!.markdown).toBe(
      `I liked this: ${TRANSCRIPT_EXCERPT_PLACEHOLDER} What do you think?`,
    );
    expect(second!.markdown).toContain(TRANSCRIPT_EXCERPT_PLACEHOLDER);
    expect(second!.markdown.length).toBeLessThan(300);
    expect(second!.markdown).toContain("Let's talk.");

    // Re-running the same input (raw text with excerpts) does not duplicate.
    const again = await saveEpisode(SLUG, {
      conversations: [
        { agent: "claude.ai", markdown: `I liked this: ${excerpt(200, 25)} What do you think?` },
      ],
    });
    expect(again.conversations).toMatchObject({ added: 0, skipped: 1 });
  });

  it("keeps a 19-word quote", async () => {
    await seedEpisode();
    await writeTranscriptFile(SLUG, transcript);
    const markdown = `Quote: "${excerpt(300, 19)}" — nice.`;
    await saveEpisode(SLUG, { notes: markdown, conversations: [{ agent: "x", markdown }] });
    expect((await readEpisode(SLUG)).notes).toBe(markdown);
    expect((await readConversations(SLUG))[0]!.markdown).toBe(markdown);
  });

  it("rejects notes and summary containing an excerpt, saying where, and writes nothing", async () => {
    const before = await seedEpisode();
    await writeTranscriptFile(SLUG, transcript);
    const error = await saveEpisode(SLUG, {
      notes: `## Notes\n\nHe said ${excerpt(400, 22)} which is interesting.`,
      summary: ["Fine point.", excerpt(900, 30)],
      conversations: [{ agent: "x", markdown: "would be added" }],
    }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscriptGuardError);
    expect(error.details).toHaveLength(2);
    expect(error.details[0]).toMatch(
      /^summary\[1\]: 30 consecutive words from the transcript, starting "/,
    );
    expect(error.details[1]).toMatch(/^notes: 22 consecutive words/);
    expect(error.details[1]).toContain(words[400]!.slice(1));
    expect(await readEpisode(SLUG)).toEqual(before);
    expect(await readConversations(SLUG)).toEqual([]);
  });

  it("without a local transcript, rejects a conversation over the size limit and accepts one under it", async () => {
    await seedEpisode();
    const big = "word ".repeat(Math.ceil(MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT / 5) + 10);
    const error = await saveEpisode(SLUG, { conversations: [{ agent: "x", markdown: big }] }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(TranscriptGuardError);
    expect(error.details[0]).toMatch(/^conversations\[0\]: \d+ KB, limit 200 KB/);
    expect(await readConversations(SLUG)).toEqual([]);

    const small = "word ".repeat(1000);
    const ok = await saveEpisode(SLUG, { conversations: [{ agent: "x", markdown: small }] });
    expect(ok).toMatchObject({ transcriptChecked: false, conversations: { added: 1 } });
  });

  it("with a local transcript, the size limit does not apply", async () => {
    await seedEpisode();
    await writeTranscriptFile(SLUG, transcript);
    const big = "my own words ".repeat(20_000); // ~260 KB, no transcript text
    const result = await saveEpisode(SLUG, { conversations: [{ agent: "x", markdown: big }] });
    expect(result.conversations.added).toBe(1);
  });

  it("writes stable JSON files", async () => {
    await seedEpisode();
    await saveEpisode(
      SLUG,
      { notes: "x", conversations: [{ agent: "a", markdown: "b" }] },
      { now: later(1) },
    );
    const episodeText = await readFile(path.join(dirs.data, "episodes", `${SLUG}.json`), "utf8");
    expect(episodeText.endsWith("}\n")).toBe(true);
    expect(episodeText.startsWith('{\n  "slug": "demo-show-first-episode",\n  "title":')).toBe(
      true,
    );
    const conversationsText = await readFile(
      path.join(dirs.data, "conversations", `${SLUG}.json`),
      "utf8",
    );
    expect(conversationsText).toBe(
      `[\n  {\n    "date": "${later(1).toISOString()}",\n    "agent": "a",\n    "markdown": "b"\n  }\n]\n`,
    );
  });
});
