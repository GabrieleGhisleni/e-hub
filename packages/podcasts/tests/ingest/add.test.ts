/**
 * previewAdd / addEpisode flows, fully offline (fake fetch + fake git) against
 * temp data/public dirs.
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/core/errors";
import { addEpisode, FeedDecisionRequiredError, previewAdd } from "../../src/core/ingest";
import { HttpError } from "../../src/core/ingest/http";
import {
  readEpisode,
  readShow,
  readShowIfExists,
  readTranscript,
  readTranscriptIfExists,
} from "../../src/core/store";
import { listFilesRecursive, useTempDirs } from "../helpers";
import {
  fakeFetch,
  fakeGit,
  fixture,
  itunesSearchUrl,
  lexIndexPage,
  lexIndexPageUrl,
  oembed,
  oembedUrl,
  pngBytes,
  watchPage,
  type FakeFetch,
} from "./fakes";

const dirs = useTempDirs();
const NOW = new Date("2026-11-10T08:00:00.000Z");
const LEX_ID = "AbCdEfGhIj0";
const LEX_SLUG = "lex-fridman-901-fake-topic-other-topic-third-topic";
const HUB_ID = "HbAAAAAAAA1";
const GENERIC_ID = "GnGnGnGnGn1";

let net: FakeFetch;

beforeEach(async () => {
  const png = await pngBytes();
  net = fakeFetch({
    // Lex
    "https://lexfridman.com/jane-roe/": await fixture("lex-episode.html"),
    "https://lexfridman.com/jane-roe-transcript": await fixture("lex-transcript.html"),
    "https://lexfridman.com/jane-roe-transcript/": await fixture("lex-transcript.html"),
    [lexIndexPageUrl(1)]: lexIndexPage(
      [{ slug: "newer-guest-transcript", youtubeId: "NeWeRNeWeR1", number: 902 }],
      true,
    ),
    [lexIndexPageUrl(2)]: lexIndexPage(
      [{ slug: "jane-roe-transcript", youtubeId: LEX_ID, number: 901 }],
      false,
    ),
    [oembedUrl(LEX_ID)]: oembed(
      "Fake Topic, Other Topic & Third Topic | Lex Fridman Podcast #901",
      "Lex Fridman",
      "https://www.youtube.com/@lexfridman",
    ),
    "https://lexfridman.com/feed/podcast/": `<rss><channel><title>Lex</title><itunes:image href="https://img.example.com/lex.jpg"/></channel></rss>`,
    "https://img.example.com/lex.jpg": png,
    // Huberman
    [oembedUrl(HUB_ID)]: oembed(
      "Gizmo Science & Better Waffles | Dr. Pat Example (Lab)",
      "Andrew Huberman",
      "https://www.youtube.com/@hubermanlab",
    ),
    "https://feeds.megaphone.fm/hubermanlab": await fixture("huberman-feed.xml"),
    "https://img.example.com/huberman-cover.jpg": png,
    // Generic
    [oembedUrl(GENERIC_ID)]: oembed(
      "Ada Example — Thinking about thinking | Sam Host",
      "Sam Host",
      "https://www.youtube.com/@samhost",
    ),
    [`https://www.youtube.com/watch?v=${GENERIC_ID}`]: watchPage({
      date: "2026-09-25T10:00:00-07:00",
    }),
    "https://www.youtube.com/@samhost": `<meta property="og:image" content="https://yt3.example.com/avatar=s900">`,
    "https://yt3.example.com/avatar=s900": png,
    [itunesSearchUrl("Sam Host")]: await fixture("itunes-search.json"),
    "https://feeds.example.com/example-talks.rss": await fixture("generic-feed.xml"),
    "https://img.example.com/example-talks.jpg": png,
  });
});

function deps(git = fakeGit()) {
  return { fetch: net.fetch, git: git.git, now: () => NOW };
}

describe("Lex Fridman", () => {
  it("adds from the episode page: metadata, transcript, show from the built-in definition", async () => {
    const result = await addEpisode("https://lexfridman.com/jane-roe/", {}, deps());
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.episode).toMatchObject({
      slug: LEX_SLUG,
      title: "#901 – Fake Topic, Other Topic & Third Topic",
      show: "lex-fridman",
      url: "https://lexfridman.com/jane-roe",
      youtubeId: LEX_ID,
      number: 901,
      publishedAt: "2026-09-16",
      // Transcript speakers minus Lex (Jane speaks first), in the description's order.
      guests: ["John Doe", "Jane Roe"],
      addedAt: NOW.toISOString(),
      transcriptSource: "lex-official",
      transcriptTimebase: "youtube",
    });
    expect(result.transcript).toEqual({
      status: "saved",
      source: "lex-official",
      timebase: "youtube",
      segments: 5,
      chapters: 2,
      estimatedStarts: false,
    });
    expect(result.show).toMatchObject({
      slug: "lex-fridman",
      created: true,
      image: "shows/lex-fridman.webp",
    });
    const transcript = await readTranscript(LEX_SLUG);
    expect(transcript).toMatchObject({
      source: "lex-official",
      timebase: "youtube",
      sourceUrl: "https://lexfridman.com/jane-roe-transcript",
      createdAt: NOW.toISOString(),
    });
    expect(transcript.segments).toHaveLength(5);
    await access(path.join(dirs.public, "shows", "lex-fridman.webp"));
    // The index map is not needed when the page links the transcript.
    expect(net.calls).not.toContain(lexIndexPageUrl(1));
  });

  it("adds the same episode from its YouTube URL through the index map, then detects duplicates", async () => {
    const result = await addEpisode(
      `https://youtu.be/${LEX_ID}?si=x&t=10`,
      { addedAt: "2025-01-02" },
      deps(),
    );
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.episode).toMatchObject({
      slug: LEX_SLUG,
      url: "https://lexfridman.com/jane-roe",
      youtubeId: LEX_ID,
      addedAt: "2025-01-02T00:00:00.000Z",
      transcriptSource: "lex-official",
    });
    // Page 1 had only a newer episode: the crawl went on to page 2 (the last) and cached the map.
    expect(net.calls.filter((url) => url.includes("/category/transcripts/"))).toEqual([
      lexIndexPageUrl(1),
      lexIndexPageUrl(2),
    ]);
    const map = JSON.parse(
      await readFile(path.join(dirs.data, "cache", "lex-transcripts.json"), "utf8"),
    );
    expect(map).toMatchObject({ complete: true });
    expect(Object.keys(map.entries).sort()).toEqual([LEX_ID, "NeWeRNeWeR1"]);

    for (const url of [
      "https://lexfridman.com/jane-roe-transcript",
      `https://www.youtube.com/watch?v=${LEX_ID}`,
    ]) {
      const again = await addEpisode(url, {}, deps());
      expect(again).toMatchObject({
        status: "duplicate",
        existing: { slug: LEX_SLUG, show: "lex-fridman" },
      });
    }
    const preview = await previewAdd(`https://www.youtube.com/live/${LEX_ID}`, deps());
    expect(preview).toMatchObject({
      status: "duplicate",
      matchedBy: "youtubeId",
      existing: { slug: LEX_SLUG },
    });
    expect(await listFilesRecursive(path.join(dirs.data, "episodes"))).toEqual([
      `${LEX_SLUG}.json`,
    ]);
  });

  it("uses the cached map without crawling, and stops a refresh of a complete map at the first known page", async () => {
    await previewAdd(`https://www.youtube.com/watch?v=${LEX_ID}`, deps());
    net.calls.length = 0;
    await previewAdd(`https://www.youtube.com/watch?v=${LEX_ID}`, deps());
    expect(net.calls.filter((url) => url.includes("/category/transcripts/"))).toEqual([]);

    // A Lex video that is not in the (complete) map: one page read, nothing new → no transcript.
    const other = "OtHeRvIdEo1";
    net.routes.set(
      oembedUrl(other),
      oembed(
        "Some Topic | Lex Fridman Podcast #77",
        "Lex Fridman",
        "https://www.youtube.com/@lexfridman",
      ),
    );
    net.routes.set(
      `https://www.youtube.com/watch?v=${other}`,
      watchPage({ date: "2020-05-01T10:00:00-07:00" }),
    );
    net.calls.length = 0;
    const preview = await previewAdd(`https://www.youtube.com/watch?v=${other}`, deps());
    expect(net.calls.filter((url) => url.includes("/category/transcripts/"))).toEqual([
      lexIndexPageUrl(1),
    ]);
    expect(preview).toMatchObject({
      status: "ready",
      source: "lex",
      url: `https://www.youtube.com/watch?v=${other}`,
      episode: { title: "#77 – Some Topic", number: 77, publishedAt: "2020-05-01" },
      transcript: { status: "none" },
    });
  });

  it("saves the episode without transcript when the transcript page is gone", async () => {
    net.routes.delete("https://lexfridman.com/jane-roe-transcript");
    const result = await addEpisode("https://lexfridman.com/jane-roe", {}, deps());
    expect(result).toMatchObject({
      status: "created",
      transcript: { status: "none", reason: "transcript page not found" },
    });
    if (result.status !== "created") return;
    expect(result.warnings.join("\n")).toContain("transcript page not found");
    expect(result.episode.transcriptSource).toBeUndefined();
    expect(result.episode.guests).toEqual(["John Doe", "Jane Roe"]); // from the description
    expect(await readTranscriptIfExists(result.episode.slug)).toBeUndefined();
  });

  it("writes nothing when the transcript fetch fails on the network", async () => {
    net.routes.set("https://lexfridman.com/jane-roe-transcript", { error: "ECONNRESET" });
    await expect(addEpisode("https://lexfridman.com/jane-roe", {}, deps())).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(await listFilesRecursive(dirs.data)).toEqual([]);
  });

  it("reports a missing episode page as not found", async () => {
    await expect(
      addEpisode("https://lexfridman.com/nobody-here", {}, deps()),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("Huberman Lab", () => {
  it("adds from YouTube: wiki transcript, official number/date from the feed", async () => {
    const git = fakeGit();
    const result = await addEpisode(`https://www.youtube.com/watch?v=${HUB_ID}`, {}, deps(git));
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.episode).toMatchObject({
      show: "huberman-lab",
      title: "Gizmo Science & Better Waffles | Dr. Pat Example (Lab)",
      url: "https://www.hubermanlab.com/episode/gizmo-science-and-better-waffles-pat-example",
      youtubeId: HUB_ID,
      number: 7, // itunes:episode, not the wiki's EP-010
      publishedAt: "2026-03-02",
      guests: ["Pat Example"],
      transcriptSource: "patrykwajs-wiki",
      transcriptTimebase: "youtube",
    });
    expect(result.transcript).toMatchObject({
      status: "saved",
      segments: 3,
      chapters: 2,
      estimatedStarts: true,
    });
    const transcript = await readTranscript(result.episode.slug);
    expect(transcript.sourceUrl).toMatch(
      /^https:\/\/github\.com\/PatrykWajs\/Huberman-Lab-Wiki\/blob\/1{40}\/docs\/Episodes\/EP-010%20/,
    );
    expect(transcript.extra).toMatchObject({ estimatedStarts: true, wikiCommit: git.head });
    expect(git.calls.map((args) => args[0])).toEqual(["clone", "rev-parse"]);
    await access(path.join(dirs.data, "cache", "huberman-wiki-index.json"));
  });

  it("resolves a hubermanlab.com URL through the feed and the wiki title, without fetching the site", async () => {
    const preview = await previewAdd(
      "https://www.hubermanlab.com/episode/essentials-how-to-fold-paper-boats",
      deps(),
    );
    expect(preview).toMatchObject({
      status: "ready",
      source: "huberman",
      url: "https://www.hubermanlab.com/episode/essentials-how-to-fold-paper-boats",
      youtubeId: "HbBBBBBBBB2",
      episode: {
        title: "Essentials: How to Fold Paper Boats",
        publishedAt: "2026-04-09",
        guests: [],
      },
      show: { status: "new", slug: "huberman-lab", known: true, needsFeedDecision: false },
      transcript: { status: "available", source: "patrykwajs-wiki" },
    });
    expect(net.calls.some((url) => url.includes("hubermanlab.com"))).toBe(false);
    await expect(
      previewAdd("https://www.hubermanlab.com/episode/not-in-the-feed", deps()),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rebuilds the wiki index when HEAD changes and keeps going when pull fails", async () => {
    const git = fakeGit({ failPull: true });
    await previewAdd(`https://www.youtube.com/watch?v=${HUB_ID}`, deps(git));
    git.head = "2222222222222222222222222222222222222222";
    // Same process, soon after: no pull (memo), but HEAD is re-read and the index rebuilt.
    await previewAdd(`https://www.youtube.com/watch?v=${HUB_ID}`, deps(git));
    expect(git.calls.map((args) => args[0])).toEqual(["clone", "rev-parse", "rev-parse"]);
    // 11 minutes later the pull runs; it fails, the local clone is used with a warning.
    const later = { ...deps(git), now: () => new Date(NOW.getTime() + 11 * 60_000) };
    const preview = await previewAdd(`https://www.youtube.com/watch?v=${HUB_ID}`, later);
    expect(git.calls.map((args) => args[0])).toContain("pull");
    expect(preview).toMatchObject({ transcript: { status: "available" } });
    if (preview.status === "ready")
      expect(preview.warnings.join("\n")).toContain("git pull of the Huberman wiki failed");
    const index = JSON.parse(
      await readFile(path.join(dirs.data, "cache", "huberman-wiki-index.json"), "utf8"),
    );
    expect(index.head).toBe(git.head);
  });

  it("saves without transcript when the wiki cannot be cloned", async () => {
    const result = await addEpisode(
      `https://www.youtube.com/watch?v=${HUB_ID}`,
      {},
      deps(fakeGit({ failClone: true })),
    );
    expect(result).toMatchObject({
      status: "created",
      transcript: { status: "none", reason: "the PatrykWajs wiki is unavailable" },
    });
    if (result.status !== "created") return;
    expect(result.warnings.join("\n")).toContain("Huberman wiki unavailable");
    expect(result.episode.guests).toEqual(["Pat Example"]); // from the title
  });
});

describe("generic YouTube channel", () => {
  const URL = `https://www.youtube.com/watch?v=${GENERIC_ID}`;

  it("previews a new show with iTunes feed candidates", async () => {
    const preview = await previewAdd(URL, deps());
    expect(preview).toMatchObject({
      status: "ready",
      source: "youtube",
      url: URL,
      youtubeId: GENERIC_ID,
      episode: {
        title: "Ada Example — Thinking about thinking",
        guests: ["Ada Example"],
        publishedAt: "2026-09-25",
      },
      show: {
        status: "new",
        slug: "sam-host",
        name: "Sam Host",
        known: false,
        youtubeAuthorUrl: "https://www.youtube.com/@samhost",
        avatarUrl: "https://yt3.example.com/avatar=s900",
        needsFeedDecision: true,
      },
      transcript: { status: "none" },
    });
    if (preview.status !== "ready" || preview.show.status !== "new") return;
    expect(preview.show.feedCandidates.map((c) => [c.feedUrl, c.match])).toEqual([
      ["https://feeds.example.com/example-talks.rss", "exact"],
      ["https://feeds.example.com/unrelated.rss", "weak"],
    ]);
    expect(await listFilesRecursive(dirs.root)).toEqual([]); // preview writes nothing
  });

  it("requires a feed decision, then creates the show without feed (avatar image)", async () => {
    await expect(addEpisode(URL, {}, deps())).rejects.toBeInstanceOf(FeedDecisionRequiredError);
    expect(await readShowIfExists("sam-host")).toBeUndefined();

    const result = await addEpisode(URL, { feed: null }, deps());
    expect(result).toMatchObject({
      status: "created",
      show: { slug: "sam-host", created: true, feedUrl: undefined, image: "shows/sam-host.webp" },
      transcript: { status: "none" },
    });
    expect(net.calls).toContain("https://yt3.example.com/avatar=s900");
    expect(await readShow("sam-host")).toMatchObject({
      name: "Sam Host",
      host: "Sam Host",
      links: { youtube: "https://www.youtube.com/@samhost" },
      youtubeAuthorUrl: "https://www.youtube.com/@samhost",
    });

    // A second video of the same channel reuses the show; no decision needed.
    const second = "GnGnGnGnGn2";
    net.routes.set(
      oembedUrl(second),
      oembed("Episode 42: Another talk | Sam Host", "Sam Host", "https://www.youtube.com/@samhost"),
    );
    const preview = await previewAdd(`https://youtu.be/${second}`, deps());
    expect(preview).toMatchObject({
      show: { status: "existing", slug: "sam-host" },
      episode: { title: "Episode 42: Another talk", number: 42 },
    });
    const added = await addEpisode(
      `https://youtu.be/${second}`,
      { feed: "https://ignored.example.com/x.rss" },
      deps(),
    );
    expect(added).toMatchObject({ status: "created", show: { created: false } });
    if (added.status === "created")
      expect(added.warnings).toContain("feed option ignored: the show already exists");
  });

  it("creates the show with a confirmed feed and its cover", async () => {
    const result = await addEpisode(
      URL,
      { feed: "https://feeds.example.com/example-talks.rss" },
      deps(),
    );
    expect(result).toMatchObject({
      status: "created",
      show: {
        slug: "sam-host",
        feedUrl: "https://feeds.example.com/example-talks.rss",
        image: "shows/sam-host.webp",
      },
    });
    expect(net.calls).toContain("https://img.example.com/example-talks.jpg");
    expect(net.calls).not.toContain("https://yt3.example.com/avatar=s900");
  });

  it("rejects an unreadable or invalid confirmed feed", async () => {
    await expect(
      addEpisode(URL, { feed: "https://feeds.example.com/missing.rss" }, deps()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(addEpisode(URL, { feed: "not a url" }, deps())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await listFilesRecursive(dirs.root)).toEqual([]);
  });

  it("still adds the episode when iTunes, the avatar and the watch page are unavailable", async () => {
    for (const url of [itunesSearchUrl("Sam Host"), "https://www.youtube.com/@samhost", URL])
      net.routes.delete(url);
    const preview = await previewAdd(URL, deps());
    expect(preview).toMatchObject({ show: { needsFeedDecision: false, feedCandidates: [] } });
    const result = await addEpisode(URL, {}, deps());
    expect(result).toMatchObject({ status: "created", show: { image: undefined } });
    if (result.status !== "created") return;
    expect(result.episode.publishedAt).toBeUndefined();
    expect(result.warnings).toContain("new show created without an image");
    expect((await readEpisode(result.episode.slug)).show).toBe("sam-host");
  });

  it("maps oEmbed 404 to not found", async () => {
    await expect(addEpisode("https://youtu.be/MiSsInGvId0", {}, deps())).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
