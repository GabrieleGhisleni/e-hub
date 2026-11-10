import { describe, expect, it } from "vitest";
import { parseFeed } from "../../src/core/ingest/feed";
import type { Http } from "../../src/core/ingest/http";
import type { Episode, Show } from "../../src/core/schema";
import {
  matchFeedEnclosure,
  resolveFeedAudio,
  titleSimilarity,
} from "../../src/cli/transcribe/feed-audio";

/** Small synthetic RSS feed (made-up shows and titles). */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Demo Show</title>
  <item>
    <title>#12 – Kalo Mivex: Sailing Ships, Old Maps &amp; the Northern Sea</title>
    <pubDate>Thu, 09 Apr 2026 17:43:17 +0000</pubDate>
    <enclosure url="https://cdn.example.com/demo_12.mp3" length="1" type="audio/mpeg" />
  </item>
  <item>
    <title>#11 – Doran Selva: Bread, Yeast and Patience</title>
    <pubDate>Mon, 06 Apr 2026 10:00:00 +0000</pubDate>
    <enclosure url="https://cdn.example.com/demo_11.mp3" length="1" type="audio/mpeg" />
  </item>
  <item>
    <title>Bonus: Questions from listeners</title>
    <pubDate>Sun, 05 Apr 2026 10:00:00 +0000</pubDate>
    <enclosure url="https://cdn.example.com/bonus.mp3" length="1" type="audio/mpeg" />
  </item>
  <item>
    <title>Trailer without audio</title>
    <pubDate>Sun, 05 Apr 2026 10:00:00 +0000</pubDate>
  </item>
  <item>
    <title>The quiet science of sleep</title>
    <itunes:episode>205</itunes:episode>
    <pubDate>Mon, 02 Mar 2026 08:00:00 +0000</pubDate>
    <enclosure url="https://cdn.example.com/sleep.mp3" length="1" type="audio/mpeg" />
  </item>
  <item>
    <title>The loud science of sleep</title>
    <pubDate>Wed, 04 Mar 2026 08:00:00 +0000</pubDate>
    <enclosure url="https://cdn.example.com/sleep-2.mp3" length="1" type="audio/mpeg" />
  </item>
</channel>
</rss>`;

const items = parseFeed(FEED)!.items;
const url = (q: Parameters<typeof matchFeedEnclosure>[1]) => {
  const match = matchFeedEnclosure(items, q);
  return (
    match && [match.item.enclosureUrl.replace("https://cdn.example.com/", ""), match.matchedBy]
  );
};

describe("feed enclosure matching", () => {
  it("matches by episode number from the title or itunes:episode", () => {
    expect(url({ number: 12, title: "anything" })).toEqual(["demo_12.mp3", "number"]);
    expect(url({ number: 205, title: "anything" })).toEqual(["sleep.mp3", "number"]);
  });

  it("falls back to title + date when the number is not in the feed", () => {
    expect(
      url({
        number: 999,
        title: "Sailing Ships, Old Maps & the Northern Sea | Demo Show #12",
        publishedAt: "2026-04-10",
      }),
    ).toEqual(["demo_12.mp3", "title-date"]);
  });

  it("matches title + publishedAt within ±3 days only", () => {
    const title = "Bread, Yeast and Patience – Doran Selva";
    expect(url({ title, publishedAt: "2026-04-03" })).toEqual(["demo_11.mp3", "title-date"]);
    expect(url({ title, publishedAt: "2026-04-10" })).toBeUndefined(); // 4 days
    expect(url({ title, publishedAt: "2026-03-01" })).toBeUndefined();
  });

  it("picks the closer title among same-week items and refuses ties", () => {
    expect(url({ title: "The quiet science of sleep", publishedAt: "2026-03-03" })).toEqual([
      "sleep.mp3",
      "title-date",
    ]);
    expect(url({ title: "Science of sleep", publishedAt: "2026-03-03" })).toBeUndefined();
  });

  it("without a date requires a near-identical title", () => {
    expect(url({ title: "#11 - Doran Selva: Bread, Yeast & Patience" })).toEqual([
      "demo_11.mp3",
      "title",
    ]);
    expect(url({ title: "Doran Selva on bread" })).toBeUndefined();
  });

  it("ignores items without an audio enclosure", () => {
    expect(url({ title: "Trailer without audio", publishedAt: "2026-04-05" })).toBeUndefined();
  });

  it("title similarity ignores suffixes, punctuation, case and stop words", () => {
    expect(
      titleSimilarity("#12 – Old Maps & the Sea", "Old maps and the sea | Demo Show #12"),
    ).toBe(1);
    expect(titleSimilarity("Old maps", "New boats")).toBe(0);
    expect(titleSimilarity("Doran Selva on bread", "#11 – Doran Selva: Bread, Yeast")).toBe(1);
    expect(
      titleSimilarity("Doran Selva on bread", "#11 – Doran Selva: Bread, Yeast", "dice"),
    ).toBeCloseTo(0.75);
  });
});

describe("resolveFeedAudio", () => {
  const show: Show = { slug: "demo-show", name: "Demo", host: "Host", links: {}, extra: {} };
  const episode = {
    slug: "demo-show-12",
    title: "Sailing Ships",
    show: "demo-show",
    number: 12,
    guests: [],
  } as unknown as Episode;
  const http = (body: string | Error): Http => ({
    text: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
    textIfExists: async () => undefined,
    json: async () => ({}),
    bytes: async () => new Uint8Array(),
  });

  it("explains why there is no fallback instead of throwing", async () => {
    expect((await resolveFeedAudio(show, episode, http(FEED))).reason).toMatch(/no feedUrl/);
    const withFeed = { ...show, feedUrl: "https://example.com/feed.xml" };
    expect((await resolveFeedAudio(withFeed, episode, http(new Error("offline")))).reason).toMatch(
      /could not read the feed .*offline/,
    );
    const resolved = await resolveFeedAudio(withFeed, episode, http(FEED));
    expect(resolved.match?.item.enclosureUrl).toBe("https://cdn.example.com/demo_12.mp3");
  });
});
