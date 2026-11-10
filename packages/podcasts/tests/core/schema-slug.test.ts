import { describe, expect, it } from "vitest";
import {
  Episode,
  Show,
  Slug,
  Transcript,
  isValidSlug,
  normalizeTag,
  normalizeTags,
} from "../../src/core/schema";
import {
  EPISODE_SLUG_MAX_LENGTH,
  generateEpisodeSlug,
  slugify,
  truncateSlug,
} from "../../src/core/slug";
import { countTags } from "../../src/core/tags";
import {
  extractYoutubeId,
  findMatchingEpisode,
  normalizeUrlForComparison,
} from "../../src/core/urls";
import { SHOW, episodeFixture } from "../helpers";

describe("Slug", () => {
  it.each(["lex-fridman", "a", "ep-452", "x1-y2-z3"])("accepts %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each([
    "",
    "Lex",
    "lex--fridman",
    "-lex",
    "lex-",
    "lex_fridman",
    "../x",
    "lex fridman",
    "è",
    "a".repeat(101),
  ])("rejects %j", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it("explains the rule", () => {
    const result = Slug.safeParse("Bad Slug");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("^[a-z0-9]+(-[a-z0-9]+)*$");
  });
});

describe("tags", () => {
  it("normalises (trim, lowercase, spaces/underscores → hyphen) and dedupes", () => {
    expect(normalizeTag("  Machine   Learning ")).toBe("machine-learning");
    expect(normalizeTag("sleep_science")).toBe("sleep-science");
    expect(normalizeTags(["AI", "ai ", "Sleep", "ai"])).toEqual(["ai", "sleep"]);
  });

  it("counts tags across episodes, most used first", () => {
    expect(countTags([{ tags: ["b", "a"] }, { tags: ["a"] }, { tags: ["c", "a", "b"] }])).toEqual([
      { tag: "a", count: 3 },
      { tag: "b", count: 2 },
      { tag: "c", count: 1 },
    ]);
  });
});

describe("entity schemas", () => {
  it("fills defaults and keeps the schema key order", () => {
    const episode = Episode.parse({
      ...episodeFixture(),
      extra: undefined,
      tags: undefined,
      summary: undefined,
    });
    expect(episode.tags).toEqual([]);
    expect(episode.summary).toEqual([]);
    expect(episode.extra).toEqual({});
    expect(Object.keys(Show.parse(SHOW))).toEqual(["slug", "name", "host", "links", "extra"]);
  });

  it("rejects unknown keys (strict) — free data goes in extra", () => {
    expect(Episode.safeParse({ ...episodeFixture(), rating: 5 }).success).toBe(false);
    expect(Episode.safeParse({ ...episodeFixture(), extra: { rating: 5 } }).success).toBe(true);
  });

  it("requires transcriptSource and transcriptTimebase together", () => {
    expect(Episode.safeParse(episodeFixture({ transcriptSource: "lex-official" })).success).toBe(
      false,
    );
    expect(
      Episode.safeParse(
        episodeFixture({ transcriptSource: "lex-official", transcriptTimebase: "youtube" }),
      ).success,
    ).toBe(true);
  });

  it("validates dates, ids and urls", () => {
    expect(Episode.safeParse(episodeFixture({ publishedAt: "2024-02-30" })).success).toBe(false);
    expect(Episode.safeParse(episodeFixture({ addedAt: "2024-02-01" })).success).toBe(false);
    expect(Episode.safeParse(episodeFixture({ youtubeId: "short" })).success).toBe(false);
    expect(Episode.safeParse(episodeFixture({ url: "javascript:alert(1)" })).success).toBe(false);
  });

  it("transcript: whisper needs audio, and audio source must match the timebase", () => {
    const base = { createdAt: "2026-11-09T00:00:00.000Z", segments: [{ start: 0, text: "hi" }] };
    expect(
      Transcript.safeParse({ ...base, source: "patrykwajs-wiki", timebase: "youtube" }).success,
    ).toBe(true);
    expect(
      Transcript.safeParse({ ...base, source: "whisper-local", timebase: "youtube" }).success,
    ).toBe(false);
    const audio = { source: "feed", url: "https://example.com/a.mp3" };
    expect(
      Transcript.safeParse({ ...base, source: "whisper-local", timebase: "youtube", audio })
        .success,
    ).toBe(false);
    expect(
      Transcript.safeParse({ ...base, source: "whisper-local", timebase: "feed", audio }).success,
    ).toBe(true);
  });
});

describe("slug generation", () => {
  it("slugifies titles", () => {
    expect(slugify("#452 – Dario Amodei: Anthropic CEO on Claude, AGI & the Future")).toBe(
      "452-dario-amodei-anthropic-ceo-on-claude-agi-the-future",
    );
    expect(slugify("Don’t Panic! Ça va?")).toBe("dont-panic-ca-va");
    expect(slugify("日本語")).toBe("");
  });

  it("truncates at a word boundary without a trailing hyphen", () => {
    expect(truncateSlug("alpha-beta-gamma", 12)).toBe("alpha-beta");
    expect(truncateSlug("alpha-beta-gamma", 10)).toBe("alpha-beta");
    expect(truncateSlug("abcdefghijklmnop", 5)).toBe("abcde");
  });

  it("builds <show>-<title>, truncated and valid", () => {
    const slug = generateEpisodeSlug(
      "lex-fridman",
      `#452 – ${"Very long title words ".repeat(10)}`,
      () => false,
    );
    expect(slug.startsWith("lex-fridman-452-very-long-title-words")).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(EPISODE_SLUG_MAX_LENGTH);
    expect(isValidSlug(slug)).toBe(true);
  });

  it("does not repeat the show name and falls back to 'episode'", () => {
    expect(generateEpisodeSlug("huberman-lab", "Huberman Lab Essentials: Sleep", () => false)).toBe(
      "huberman-lab-essentials-sleep",
    );
    expect(generateEpisodeSlug("demo", "日本語", () => false)).toBe("demo-episode");
  });

  it("is unique: appends -2, -3… within the max length", () => {
    const taken = new Set(["demo-title", "demo-title-2"]);
    expect(generateEpisodeSlug("demo", "Title", (slug) => taken.has(slug))).toBe("demo-title-3");

    const long = `${"word ".repeat(40)}`;
    const first = generateEpisodeSlug("demo", long, () => false);
    const second = generateEpisodeSlug("demo", long, (slug) => slug === first);
    expect(second).not.toBe(first);
    expect(second.endsWith("-2")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(EPISODE_SLUG_MAX_LENGTH);
    expect(isValidSlug(second)).toBe(true);
  });
});

describe("urls", () => {
  it.each([
    ["https://www.youtube.com/watch?v=ugvHCXCOmm4&t=10s", "ugvHCXCOmm4"],
    ["https://youtu.be/ugvHCXCOmm4?si=abc", "ugvHCXCOmm4"],
    ["https://m.youtube.com/shorts/ugvHCXCOmm4", "ugvHCXCOmm4"],
    ["https://www.youtube.com/embed/ugvHCXCOmm4", "ugvHCXCOmm4"],
    ["https://www.youtube.com/live/ugvHCXCOmm4", "ugvHCXCOmm4"],
    ["https://lexfridman.com/dario-amodei", undefined],
    ["https://www.youtube.com/watch?v=bad", undefined],
    ["not a url", undefined],
  ])("extractYoutubeId(%s) = %s", (url, id) => {
    expect(extractYoutubeId(url)).toBe(id);
  });

  it("normalises URLs for comparison", () => {
    expect(
      normalizeUrlForComparison("http://www.LexFridman.com/dario-amodei/?utm_source=x#top"),
    ).toBe("https://lexfridman.com/dario-amodei");
  });

  it("finds duplicates by youtube id (from either URL) or by URL", () => {
    const episodes = [
      { slug: "a", url: "https://lexfridman.com/dario-amodei", youtubeId: "ugvHCXCOmm4" },
      { slug: "b", url: "https://www.youtube.com/watch?v=wbJ_Q1xsDHg" },
    ];
    expect(findMatchingEpisode(episodes, { url: "https://youtu.be/ugvHCXCOmm4" })).toMatchObject({
      episode: { slug: "a" },
      matchedBy: "youtubeId",
    });
    expect(
      findMatchingEpisode(episodes, { url: "https://example.com", youtubeId: "wbJ_Q1xsDHg" })
        ?.episode.slug,
    ).toBe("b");
    expect(
      findMatchingEpisode(episodes, { url: "https://lexfridman.com/dario-amodei/" }),
    ).toMatchObject({ episode: { slug: "a" }, matchedBy: "url" });
    expect(findMatchingEpisode(episodes, { url: "https://lexfridman.com/other" })).toBeUndefined();
  });
});
