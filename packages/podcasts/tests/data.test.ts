/**
 * Read-only checks on the real, tracked data (data/shows, data/episodes,
 * data/conversations, public/shows): every file validates and references
 * resolve. Never writes.
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/core/paths";
import { ConversationsFile, Episode, Show } from "../src/core/schema";

async function jsonFiles(dir: string): Promise<Array<{ slug: string; data: unknown }>> {
  const names = (await readdir(path.join(REPO_ROOT, dir)).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  );
  return Promise.all(
    names.map(async (name) => ({
      slug: path.basename(name, ".json"),
      data: JSON.parse(await readFile(path.join(REPO_ROOT, dir, name), "utf8")) as unknown,
    })),
  );
}

describe("tracked data", () => {
  it("shows are valid, named after their slug, and their images exist", async () => {
    const shows = await jsonFiles("data/shows");
    expect(shows.map((show) => show.slug)).toEqual(
      expect.arrayContaining(["lex-fridman", "huberman-lab"]),
    );
    for (const { slug, data } of shows) {
      const show = Show.parse(data);
      expect(show.slug).toBe(slug);
      if (show.image) await access(path.join(REPO_ROOT, "public", show.image));
    }
  });

  it("episodes and conversations are valid and reference existing shows/episodes", async () => {
    const showSlugs = new Set((await jsonFiles("data/shows")).map((show) => show.slug));
    const episodes = await jsonFiles("data/episodes");
    for (const { slug, data } of episodes) {
      const episode = Episode.parse(data);
      expect(episode.slug).toBe(slug);
      expect(showSlugs.has(episode.show)).toBe(true);
    }
    const episodeSlugs = new Set(episodes.map((episode) => episode.slug));
    for (const { slug, data } of await jsonFiles("data/conversations")) {
      ConversationsFile.parse(data);
      expect(episodeSlugs.has(slug)).toBe(true);
    }
  });
});
