import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findFeedItem, parseFeed } from "../../src/core/ingest/feed";
import {
  findWikiEntry,
  parseWikiTranscript,
  wikiEntryFromMarkdown,
  wikiFileUrl,
  wikiGuests,
} from "../../src/core/ingest/huberman";
import { parseItunesResults } from "../../src/core/ingest/itunes";
import {
  parseLexEpisodePage,
  parseLexTranscriptIndexPage,
  parseLexTranscriptPage,
} from "../../src/core/ingest/lex";
import {
  parseChannelAvatar,
  parseOembed,
  parseWatchPage,
  stripChannelSuffix,
} from "../../src/core/ingest/youtube";
import { FIXTURES, fixture, lexIndexPage, oembed, watchPage } from "./fakes";

const WIKI_EP10 =
  "docs/Episodes/EP-010 - Gizmo Science and Better Waffles - Dr. Pat Example/transcript.md";
const WIKI_EP11 = "docs/Episodes/EP-011 - Essentials - How to Fold Paper Boats/transcript.md";
const WIKI_EP12 = "docs/Episodes/EP-012 - LIVE EVENT QandA - Untimed Session/transcript.md";
const wikiFile = (relative: string) => readFile(path.join(FIXTURES, "wiki", relative), "utf8");

describe("Lex Fridman pages", () => {
  it("parses an episode page", async () => {
    const page = parseLexEpisodePage(await fixture("lex-episode.html"), "fallback");
    expect(page).toEqual({
      url: "https://lexfridman.com/jane-roe",
      slug: "jane-roe",
      title: "#901 – Fake Topic, Other Topic & Third Topic",
      number: 901,
      publishedAt: "2026-09-16", // site-local date, not the UTC article:published_time
      youtubeId: "AbCdEfGhIj0",
      transcriptUrl: "https://lexfridman.com/jane-roe-transcript", // not the sidebar's other transcript
      description:
        "John Doe and Jane Roe are two researchers of imaginary things. Jane Roe works on gizmos.",
      guests: ["John Doe", "Jane Roe"],
    });
  });

  it("returns undefined for a page without an entry title", () => {
    expect(parseLexEpisodePage("<html><body><p>Nope</p></body></html>", "x")).toBeUndefined();
  });

  it("parses a transcript page into segments and chapters", async () => {
    const transcript = parseLexTranscriptPage(await fixture("lex-transcript.html"));
    expect(transcript.youtubeId).toBe("AbCdEfGhIj0");
    expect(transcript.number).toBe(901);
    expect(transcript.guests).toEqual(["Jane Roe", "John Doe"]);
    expect(transcript.chapters).toEqual([
      { title: "Introduction", start: 0 },
      { title: "Gizmos", start: 80 },
    ]);
    expect(transcript.segments).toEqual([
      {
        speaker: "Lex Fridman",
        start: 0,
        text: "The following is a chat about purple gizmos and the art of waffling.",
      },
      { speaker: "Jane Roe", start: 52, text: "Thanks for having me, it’s a pleasure." },
      { speaker: "John Doe", start: 80, text: "Gizmos are mostly made of cardboard and optimism." },
      { speaker: "Lex Fridman", start: 3725, text: "Is cardboard underrated?" },
      // No link: start parsed from the "(01:02:09)" label.
      { speaker: "Jane Roe", start: 3729, text: "Deeply underrated." },
    ]);
  });

  it("finds no segments in an unknown layout", () => {
    expect(
      parseLexTranscriptPage("<html><body><p>changed layout</p></body></html>").segments,
    ).toEqual([]);
  });

  it("parses transcript index pages, skipping posts without a video", () => {
    const html = lexIndexPage(
      [
        { slug: "jane-roe-transcript", youtubeId: "AbCdEfGhIj0", number: 901 },
        { slug: "jane-roe-files", number: 901 },
        { slug: "old-guest-transcript", number: 12 },
      ],
      true,
    );
    expect(parseLexTranscriptIndexPage(html)).toEqual({
      hasOlder: true,
      entries: [
        {
          youtubeId: "AbCdEfGhIj0",
          transcriptUrl: "https://lexfridman.com/jane-roe-transcript/",
          episodeUrl: "https://lexfridman.com/jane-roe",
          title: "Transcript for Topic | Lex Fridman Podcast #901",
        },
      ],
    });
    expect(parseLexTranscriptIndexPage(lexIndexPage([], false))).toEqual({
      entries: [],
      hasOlder: false,
    });
  });
});

describe("Huberman wiki", () => {
  it("indexes frontmatter variants", async () => {
    expect(wikiEntryFromMarkdown(WIKI_EP10, await wikiFile(WIKI_EP10))).toEqual({
      path: WIKI_EP10,
      title: "Gizmo Science & Better Waffles | Dr. Pat Example",
      youtubeId: "HbAAAAAAAA1",
      wikiNumber: 10,
      date: "2026-03-02",
      speakers: ["Andrew Huberman", "Dr. Pat Example"],
    });
    expect(wikiEntryFromMarkdown(WIKI_EP11, await wikiFile(WIKI_EP11))).toMatchObject({
      youtubeId: "HbBBBBBBBB2",
      date: "2026-04-06",
      speakers: ["Andrew Huberman"],
    });
    // `video_id` instead of `youtube_id`, no date.
    expect(wikiEntryFromMarkdown(WIKI_EP12, await wikiFile(WIKI_EP12))).toMatchObject({
      youtubeId: "HbCCCCCCCC3",
      date: undefined,
    });
    // No frontmatter title: H1, then the directory name.
    expect(
      wikiEntryFromMarkdown(
        "docs/Episodes/EP-001 - Dir Title/transcript.md",
        "---\nyoutube_url: https://youtu.be/HbDDDDDDDD4\n---\n\ntext",
      ),
    ).toMatchObject({
      title: "Dir Title",
      youtubeId: "HbDDDDDDDD4",
      speakers: [],
    });
  });

  it("matches by YouTube id, then title — never by number", () => {
    const entries = [
      {
        path: "a",
        title: "Gizmo Science & Better Waffles | Dr. Pat Example",
        youtubeId: "HbAAAAAAAA1",
        wikiNumber: 7,
        speakers: [],
      },
      {
        path: "b",
        title: "Essentials: How to Fold Paper Boats",
        youtubeId: "HbBBBBBBBB2",
        wikiNumber: 11,
        speakers: [],
      },
    ];
    expect(findWikiEntry(entries, { youtubeId: "HbBBBBBBBB2" })?.entry.path).toBe("b");
    expect(
      findWikiEntry(entries, { title: "Gizmo Science and Better Waffles | Pat Example (Lab)" }),
    ).toMatchObject({
      entry: { path: "a" },
      matchedBy: "title",
    });
    // A title match must not contradict a different known id.
    expect(
      findWikiEntry(entries, {
        youtubeId: "HbZZZZZZZZ9",
        title: "Essentials: How to Fold Paper Boats",
      }),
    ).toBeUndefined();
    expect(findWikiEntry(entries, { title: "Something else entirely here" })).toBeUndefined();
    expect(
      wikiGuests({
        path: "x",
        title: "t",
        speakers: ["Andrew Huberman", "Dr. Pat Example", "Alok Kanojia (Dr. K)"],
      }),
    ).toEqual(["Pat Example", "Alok Kanojia"]);
  });

  it("parses chapter headings with untimed paragraphs (interpolated starts)", async () => {
    const parsed = parseWikiTranscript(await wikiFile(WIKI_EP10));
    expect(parsed.estimatedStarts).toBe(true);
    expect(parsed.chapters).toEqual([
      { title: "Pat Example", start: 0 },
      { title: "Waffle Theory & Practice", start: 100 },
    ]);
    // 17 words then 10 words between the 0 s and 100 s headings → 17/27 of the span.
    expect(parsed.segments.map((s) => s.start)).toEqual([0, 63, 100]);
    expect(parsed.segments[0]!.text).toBe(
      "Synthetic opening words about gizmos and waffles, made up for tests. This line continues the same paragraph.",
    );
    expect(parsed.segments.every((s) => s.speaker === undefined)).toBe(true);
  });

  it("parses [HH:MM:SS] lines exactly, with continuation lines", async () => {
    const parsed = parseWikiTranscript(await wikiFile(WIKI_EP11));
    expect(parsed).toEqual({
      estimatedStarts: false,
      chapters: [],
      segments: [
        { start: 0, text: "Welcome to a synthetic episode about paper boats." },
        {
          start: 4,
          text: "Fold the sheet in half, then fold it again and keep folding until it floats.",
        },
        { start: 12, text: "That is all for today." },
      ],
    });
  });

  it("returns nothing when there are no timestamps", async () => {
    expect(parseWikiTranscript(await wikiFile(WIKI_EP12)).segments).toEqual([]);
  });

  it("handles speaker labels, stamp lines and heading variants", () => {
    const markdown = [
      "# Title",
      "> **Note:** auto-generated.",
      "## Opening",
      "*[00:00:10]*",
      "**Andrew Huberman:** Hello there, synthetic friend.",
      "Still the same speaker here.",
      "",
      "**Pat Example:** Hi.",
      "",
      "**Andrew Huberman / Pat Example:** Mixed attribution.",
      "",
      "**Tool:** keep this bold label as text.",
      "---",
      "## Middle (00:01:00)",
      "Untimed paragraph.",
      "## 00:02:00 - Late part",
      "Late paragraph.",
      "## [05:00] Short stamp",
      "Five minutes in.",
    ].join("\n");
    const parsed = parseWikiTranscript(markdown);
    expect(parsed.chapters).toEqual([
      { title: "Opening", start: 10 },
      { title: "Middle", start: 60 },
      { title: "Late part", start: 120 },
      { title: "Short stamp", start: 300 },
    ]);
    expect(parsed.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Andrew Huberman", "Hello there, synthetic friend. Still the same speaker here."],
      ["Pat Example", "Hi."],
      [undefined, "Mixed attribution."],
      [undefined, "Tool: keep this bold label as text."],
      [undefined, "Untimed paragraph."],
      [undefined, "Late paragraph."],
      [undefined, "Five minutes in."],
    ]);
    const starts = parsed.segments.map((s) => s.start);
    expect(starts[0]).toBe(10);
    expect(starts.slice(4)).toEqual([60, 120, 300]);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("builds a GitHub URL for the file at the clone's commit", () => {
    expect(wikiFileUrl("abc123", WIKI_EP11)).toBe(
      "https://github.com/PatrykWajs/Huberman-Lab-Wiki/blob/abc123/docs/Episodes/EP-011%20-%20Essentials%20-%20How%20to%20Fold%20Paper%20Boats/transcript.md",
    );
  });
});

describe("YouTube, feeds, iTunes", () => {
  it("parses oEmbed and watch pages", () => {
    expect(
      parseOembed(
        "AbCdEfGhIj0",
        JSON.parse(oembed("A &amp; B", "Sam Host", "https://www.youtube.com/@samhost")),
      ),
    ).toEqual({
      youtubeId: "AbCdEfGhIj0",
      title: "A &amp; B",
      authorName: "Sam Host",
      authorUrl: "https://www.youtube.com/@samhost",
    });
    expect(parseOembed("AbCdEfGhIj0", { title: "x" })).toBeUndefined();
    expect(
      parseWatchPage(
        watchPage({
          date: "2026-09-16T17:34:47-07:00",
          title: "Freud &amp; Jung",
          author: "https://www.youtube.com/@x",
        }),
      ),
    ).toEqual({
      title: "Freud & Jung",
      authorName: "Channel",
      authorUrl: "https://www.youtube.com/@x",
      publishedAt: "2026-09-16",
    });
    expect(parseWatchPage("<html>consent wall</html>")).toEqual({
      title: undefined,
      authorName: undefined,
      authorUrl: undefined,
      publishedAt: undefined,
    });
    expect(
      parseChannelAvatar('<meta property="og:image" content="https://yt3.example.com/a=s900">'),
    ).toBe("https://yt3.example.com/a=s900");
  });

  it("strips the channel suffix from titles", () => {
    expect(stripChannelSuffix("Ada Example — Thinking | Sam Host", ["Sam Host"])).toBe(
      "Ada Example — Thinking",
    );
    expect(stripChannelSuffix("Sam Host", ["Sam Host"])).toBe("Sam Host");
    expect(stripChannelSuffix("Topic - sam host", ["Sam Host"])).toBe("Topic");
  });

  it("parses RSS feeds and finds items by link or title", async () => {
    const feed = parseFeed(await fixture("huberman-feed.xml"))!;
    expect(feed.coverUrl).toBe("https://img.example.com/huberman-cover.jpg");
    expect(feed.items[1]).toEqual({
      title: "Gizmo Science & Better Waffles | Dr. Pat Example",
      link: "https://www.hubermanlab.com/episode/gizmo-science-and-better-waffles-pat-example",
      number: 7,
      publishedAt: "2026-03-02",
      enclosureUrl: "https://audio.example.com/gizmo.mp3",
    });
    expect(feed.items[0]!.number).toBeUndefined();
    expect(
      findFeedItem(feed.items, {
        link: "https://hubermanlab.com/episode/gizmo-science-and-better-waffles-pat-example/",
      })?.number,
    ).toBe(7);
    expect(
      findFeedItem(feed.items, { title: "Gizmo Science & Better Waffles | Dr. Pat Example (Lab)" })
        ?.number,
    ).toBe(7);
    expect(findFeedItem(feed.items, { title: "Unknown" })).toBeUndefined();
    const generic = parseFeed(await fixture("generic-feed.xml"))!;
    expect(generic).toMatchObject({
      title: "Example Talks",
      author: "Sam Host",
      coverUrl: "https://img.example.com/example-talks.jpg",
    });
    expect(generic.items[0]!.title).toBe("Ada Example — Thinking about thinking");
    expect(parseFeed("<html>not rss</html>")).toBeUndefined();
  });

  it("ranks iTunes candidates and drops results without a feed", async () => {
    const candidates = parseItunesResults(JSON.parse(await fixture("itunes-search.json")), [
      "Sam Host",
    ]);
    expect(candidates).toEqual([
      {
        feedUrl: "https://feeds.example.com/example-talks.rss",
        title: "Example Talks",
        author: "Sam Host",
        artworkUrl: "https://img.example.com/example-talks-600.jpg",
        episodeCount: 145,
        itunesUrl: "https://podcasts.apple.com/us/podcast/example-talks/id1",
        match: "exact",
      },
      {
        feedUrl: "https://feeds.example.com/unrelated.rss",
        title: "Unrelated Show",
        author: "Someone Else",
        artworkUrl: undefined,
        episodeCount: 12,
        itunesUrl: undefined,
        match: "weak",
      },
    ]);
    expect(parseItunesResults({ nope: true }, ["x"])).toEqual([]);
  });
});
