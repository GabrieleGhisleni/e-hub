/**
 * Offline fakes for ingest tests: a `fetch` that serves fixtures by exact
 * URL (anything else → 404) and a `git` that "clones" the synthetic wiki
 * fixture into the target dir. All content is synthetic (DESIGN.md §3.1).
 */
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FetchLike } from "../../src/core/ingest/http";
import type { GitRunner } from "../../src/core/ingest/git";
import { lexIndexPageUrl } from "../../src/core/ingest/lex";
import { oembedUrl } from "../../src/core/ingest/youtube";
import { itunesSearchUrl } from "../../src/core/ingest/itunes";
import { REPO_ROOT } from "../../src/core/paths";

export const FIXTURES = path.join(REPO_ROOT, "tests", "fixtures", "ingest");

export function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), "utf8");
}

export type Route =
  | string
  | Uint8Array
  | { status: number; body?: string }
  | { error: string }
  | (() => Route);

export interface FakeFetch {
  fetch: FetchLike;
  routes: Map<string, Route>;
  calls: string[];
}

/** A fake `fetch` serving `routes` by exact URL; unknown URLs → 404. */
export function fakeFetch(routes: Record<string, Route> = {}): FakeFetch {
  const map = new Map(Object.entries(routes));
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    let route = map.get(url);
    while (typeof route === "function") route = route();
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "string") return new Response(route, { status: 200 });
    if (route instanceof Uint8Array) return new Response(route, { status: 200 });
    if ("error" in route) throw new TypeError(route.error);
    return new Response(route.body ?? "", { status: route.status });
  };
  return { fetch, routes: map, calls };
}

export interface FakeGit {
  git: GitRunner;
  calls: string[][];
  /** HEAD returned by `rev-parse`; change it to simulate a pull bringing new commits. */
  head: string;
}

/** `clone` copies tests/fixtures/ingest/wiki into the target; `pull` is a no-op. */
export function fakeGit(options: { failClone?: boolean; failPull?: boolean } = {}): FakeGit {
  const state: FakeGit = {
    calls: [],
    head: "1111111111111111111111111111111111111111",
    git: async (args) => {
      state.calls.push(args);
      if (args[0] === "clone") {
        if (options.failClone) throw new Error("git clone failed: network unreachable");
        const target = args.at(-1)!;
        await cp(path.join(FIXTURES, "wiki"), target, { recursive: true });
        await mkdir(path.join(target, ".git"), { recursive: true });
        return "";
      }
      if (args[0] === "pull") {
        if (options.failPull) throw new Error("git pull failed: offline");
        return "";
      }
      if (args[0] === "rev-parse") return `${state.head}\n`;
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
  };
  return state;
}

/** A small real PNG (sharp must be able to convert show images). */
export function pngBytes(color = "#3366cc"): Promise<Uint8Array> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));
}

export function oembed(title: string, authorName: string, authorUrl: string): string {
  return JSON.stringify({
    title,
    author_name: authorName,
    author_url: authorUrl,
    type: "video",
    provider_name: "YouTube",
  });
}

export function watchPage(
  options: { date?: string; title?: string; author?: string } = {},
): string {
  const author = options.author ?? "https://www.youtube.com/@example";
  return `<html><head><meta name="title" content="${options.title ?? "Video"}"></head><body>
<span itemprop="author" itemscope itemtype="http://schema.org/Person"><link itemprop="url" href="${author.replace("https:", "http:")}"><link itemprop="name" content="Channel"></span>
${options.date ? `<meta itemprop="datePublished" content="${options.date}">` : ""}
</body></html>`;
}

/** One synthetic page of Lex's "transcripts" category index. */
export function lexIndexPage(
  posts: Array<{ slug: string; youtubeId?: string; number: number }>,
  hasOlder: boolean,
): string {
  const articles = posts
    .map(
      (post, index) => `<article id="post-${index + 1}">
  <h1 class="entry-title"><a href="https://lexfridman.com/${post.slug}/">Transcript for Topic | Lex Fridman Podcast #${post.number}</a></h1>
  <div class="entry-content">
    <ul><li>Go back to <a href="https://lexfridman.com/${post.slug.replace(/-transcript$/, "")}/">this episode&#8217;s main page</a></li></ul>
    ${
      post.youtubeId
        ? `<div class="ts-segment"><span class="ts-name">Lex Fridman</span><span class="ts-timestamp"><a href="https://youtube.com/watch?v=${post.youtubeId}&#038;t=0">(00:00:00)</a></span><span class="ts-text">Synthetic.</span></div>`
        : "<p>Files for an episode, no timestamps.</p>"
    }
  </div>
</article>`,
    )
    .join("\n");
  const nav = hasOlder
    ? `<div class="nav-previous"><a href="https://lexfridman.com/category/transcripts/page/2/">Older posts</a></div>`
    : "";
  return `<html><body>${articles}${nav}</body></html>`;
}

export { itunesSearchUrl, lexIndexPageUrl, oembedUrl };
