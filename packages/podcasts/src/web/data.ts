/**
 * Site data from the tracked JSON files (DESIGN.md §8.1):
 *
 * - shows and episodes: `import.meta.glob` **eager**, bundled at build time
 *   (no fetch, no API). Only `data/shows/` and `data/episodes/`; never
 *   `data/transcripts/` or `data/cache/`.
 * - conversations: `import.meta.glob` **lazy**, one chunk per episode, loaded
 *   only when the detail page opens its conversations section.
 *
 * In dev, Vite reloads when a data file is written (by the local server or
 * the CLI): the frontend always reads from the files.
 */
import type { Conversation } from "@core/schema";
import { buildCatalog } from "@podcasts/lib/catalog";
import type { SiteData } from "@podcasts/site-data";

const showModules = import.meta.glob<unknown>("../../data/shows/*.json", {
  eager: true,
  import: "default",
});
const episodeModules = import.meta.glob<unknown>("../../data/episodes/*.json", {
  eager: true,
  import: "default",
});
const conversationModules = import.meta.glob<unknown>("../../data/conversations/*.json", {
  import: "default",
});

function slugFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

const conversationLoaders = new Map(
  Object.entries(conversationModules).map(([path, load]) => [slugFromPath(path), load]),
);

function toConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Conversation =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Conversation).date === "string" &&
      typeof (item as Conversation).agent === "string" &&
      typeof (item as Conversation).markdown === "string",
  );
}

export const siteData: SiteData = {
  catalog: buildCatalog(Object.values(showModules), Object.values(episodeModules)),
  conversations: {
    has: (slug) => conversationLoaders.has(slug),
    load: async (slug) => {
      const load = conversationLoaders.get(slug);
      return load ? toConversations(await load()) : [];
    },
  },
};
