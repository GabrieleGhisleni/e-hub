/**
 * Post-build step (scripts/static-pages.ts): per-episode index.html copies
 * and 404.html, on a temp dist + data dir (never the real ones).
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  episodePageMeta,
  escapeHtml,
  withPageMeta,
  writeStaticPages,
} from "../scripts/static-pages";
import { Episode, Show } from "../src/core/schema";

const INDEX_HTML = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <title>e-podcasts</title>
    <script type="module" crossorigin src="/podcasts/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

const show = Show.parse({ slug: "alpha", name: "Alpha Show", host: "Host" });
const episode = Episode.parse({
  slug: "alpha-sleep",
  title: 'Sleep & "Dreams" <$&> $1',
  show: "alpha",
  guests: ["Matt Walker"],
  url: "https://example.com/sleep",
  youtubeId: "abcdefghijk",
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  summary: ["Light in the morning.", "No caffeine late."],
});

describe("page meta", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("builds title, description and preview image for an episode", () => {
    expect(episodePageMeta(episode, show)).toEqual({
      title: 'Sleep & "Dreams" <$&> $1 · e-podcasts',
      description: "Alpha Show — con Matt Walker. Light in the morning. · No caffeine late.",
      image: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    });
    const long = episodePageMeta({ ...episode, summary: ["word ".repeat(100)] }, undefined);
    expect(long.description!.length).toBeLessThanOrEqual(200);
    expect(long.description).toMatch(/^alpha — con Matt Walker\. word .*…$/);
  });

  it("replaces the title and adds meta tags, keeping `$` patterns literal", () => {
    const html = withPageMeta(INDEX_HTML, episodePageMeta(episode, show));
    expect(html).toContain(
      "<title>Sleep &amp; &quot;Dreams&quot; &lt;$&amp;&gt; $1 · e-podcasts</title>",
    );
    expect(html).not.toContain("<title>e-podcasts</title>");
    expect(html).toContain('<meta name="description" content="Alpha Show — con Matt Walker.');
    expect(html).toContain(
      '<meta property="og:image" content="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" />',
    );
    expect(html).toContain('src="/podcasts/assets/index-abc.js"');
    expect(html.indexOf("og:title")).toBeLessThan(html.indexOf("</head>"));
  });
});

describe("writeStaticPages", () => {
  let root: string;
  let dist: string;
  let data: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "e-podcasts-static-"));
    dist = path.join(root, "dist");
    data = path.join(root, "data");
    await mkdir(dist, { recursive: true });
    await mkdir(path.join(data, "shows"), { recursive: true });
    await mkdir(path.join(data, "episodes"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), INDEX_HTML);
    await writeFile(path.join(data, "shows", "alpha.json"), JSON.stringify(show));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes episode/<slug>/index.html for every episode and 404.html", async () => {
    await writeFile(path.join(data, "episodes", "alpha-sleep.json"), JSON.stringify(episode));
    const other = { ...episode, slug: "alpha-two", title: "Two", youtubeId: undefined };
    await writeFile(path.join(data, "episodes", "alpha-two.json"), JSON.stringify(other));

    const written = await writeStaticPages(dist, data);
    expect(written.toSorted()).toEqual([
      "404.html",
      path.join("episode", "alpha-sleep", "index.html"),
      path.join("episode", "alpha-two", "index.html"),
    ]);
    expect(await readdir(path.join(dist, "episode"))).toEqual(["alpha-sleep", "alpha-two"]);
    expect(await readFile(path.join(dist, "404.html"), "utf8")).toBe(INDEX_HTML);
    const page = await readFile(path.join(dist, "episode", "alpha-two", "index.html"), "utf8");
    expect(page).toContain("<title>Two · e-podcasts</title>");
    expect(page).not.toContain("og:image");
  });

  it("works with no episodes (only 404.html)", async () => {
    expect(await writeStaticPages(dist, data)).toEqual(["404.html"]);
  });

  it("fails on an invalid episode file or a slug that does not match the file name", async () => {
    await writeFile(
      path.join(data, "episodes", "alpha-bad.json"),
      JSON.stringify({ ...episode, slug: "alpha-bad", sumary: [] }),
    );
    await expect(writeStaticPages(dist, data)).rejects.toThrow(/alpha-bad\.json[\s\S]*sumary/);

    await rm(path.join(data, "episodes", "alpha-bad.json"));
    await writeFile(path.join(data, "episodes", "elsewhere.json"), JSON.stringify(episode));
    await expect(writeStaticPages(dist, data)).rejects.toThrow(/does not match the file name/);
  });
});
