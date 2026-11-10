/**
 * Post-build step (DESIGN.md §8.2), as a Vite plugin run by `pnpm build`:
 *
 * - `dist/episode/<slug>/index.html` for every episode, so a direct link
 *   answers 200 on GitHub Pages (the SPA then reads the URL). Each copy gets
 *   the episode's `<title>` and description/Open Graph tags for link previews.
 * - `dist/404.html`, the fallback Pages serves (status 404) for unknown URLs.
 *
 * Episodes are read from `data/episodes/*.json` and validated: an invalid
 * file fails the build instead of being published.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger, Plugin } from "vite";
import type { ZodSafeParseResult } from "zod";
import { Episode, Show, formatIssues, isValidSlug } from "../src/core/schema.ts";

const SITE_NAME = "e-podcasts";
const DESCRIPTION_MAX_LENGTH = 200;

export interface PageMeta {
  title: string;
  description?: string;
  image?: string;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}

/** Title + description + preview image for an episode page. */
export function episodePageMeta(episode: Episode, show: Show | undefined): PageMeta {
  const showName = show?.name ?? episode.show;
  const byline = [showName, episode.guests.length > 0 ? `con ${episode.guests.join(", ")}` : ""]
    .filter(Boolean)
    .join(" — ");
  const description =
    episode.summary.length > 0 ? `${byline}. ${episode.summary.join(" · ")}` : byline;
  return {
    title: `${episode.title} · ${SITE_NAME}`,
    description: truncate(description, DESCRIPTION_MAX_LENGTH),
    ...(episode.youtubeId
      ? { image: `https://i.ytimg.com/vi/${episode.youtubeId}/hqdefault.jpg` }
      : {}),
  };
}

/** Replaces `<title>` and adds description / Open Graph tags before `</head>`. */
export function withPageMeta(html: string, meta: PageMeta): string {
  const tags = [
    meta.description && `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    meta.description &&
      `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    meta.image && `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `<meta property="og:type" content="article" />`,
  ].filter(Boolean);
  const title = `<title>${escapeHtml(meta.title)}</title>`;
  // Function replacers: `$&`-style patterns in titles must stay literal.
  const withTitle = /<title>[\s\S]*?<\/title>/.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/, () => title)
    : html.replace("</head>", () => `  ${title}\n  </head>`);
  return withTitle.replace("</head>", () => `  ${tags.join("\n    ")}\n  </head>`);
}

async function readJsonDir(dir: string): Promise<Array<{ file: string; data: unknown }>> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".json"))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      file: path.join(dir, name),
      data: JSON.parse(await readFile(path.join(dir, name), "utf8")) as unknown,
    })),
  );
}

function unwrap<T>(result: ZodSafeParseResult<T>, file: string): T {
  if (result.success) return result.data;
  const issues = formatIssues(result.error).map((line) => `  - ${line}`);
  throw new Error(`invalid ${file}:\n${issues.join("\n")}`);
}

/** Validated episodes (+ their shows) from a data dir. Throws on an invalid file. */
export async function loadEpisodePages(
  dataDir: string,
): Promise<Array<{ episode: Episode; show: Show | undefined }>> {
  const shows = new Map(
    (await readJsonDir(path.join(dataDir, "shows"))).map(({ file, data }) => {
      const show = unwrap(Show.safeParse(data), file);
      return [show.slug, show] as const;
    }),
  );
  return (await readJsonDir(path.join(dataDir, "episodes"))).map(({ file, data }) => {
    const episode = unwrap(Episode.safeParse(data), file);
    if (!isValidSlug(episode.slug) || path.basename(file, ".json") !== episode.slug) {
      throw new Error(`invalid ${file}: slug '${episode.slug}' does not match the file name`);
    }
    return { episode, show: shows.get(episode.show) };
  });
}

/** Writes the per-episode copies and `404.html` next to `index.html` in `outDir`. Returns the written paths (relative). */
export async function writeStaticPages(
  outDir: string,
  dataDir: string,
  urlPrefix = "",
): Promise<string[]> {
  const indexHtml = await readFile(path.join(outDir, "index.html"), "utf8");
  const written: string[] = [];
  for (const { episode, show } of await loadEpisodePages(dataDir)) {
    const relative = path.join(urlPrefix, "episode", episode.slug, "index.html");
    await mkdir(path.join(outDir, urlPrefix, "episode", episode.slug), { recursive: true });
    await writeFile(
      path.join(outDir, relative),
      withPageMeta(indexHtml, episodePageMeta(episode, show)),
    );
    written.push(relative);
  }
  await writeFile(path.join(outDir, "404.html"), indexHtml);
  written.push("404.html");
  return written;
}

export function staticPages(options: { dataDir?: string; urlPrefix?: string } = {}): Plugin {
  let root = process.cwd();
  let outDir = "dist";
  let logger: Logger | undefined;
  return {
    name: "e-podcasts:static-pages",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
      logger = config.logger;
    },
    async closeBundle() {
      const dataDir = options.dataDir ?? path.join(root, "data");
      const written = await writeStaticPages(outDir, dataDir, options.urlPrefix);
      logger?.info(`static pages: ${written.length - 1} episode page(s) + 404.html`);
    },
  };
}
