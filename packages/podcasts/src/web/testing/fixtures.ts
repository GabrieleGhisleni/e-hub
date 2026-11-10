/**
 * Synthetic data for the web tests (never imported by the app). Records
 * follow the stored format (defaults filled in), like files written by core.
 */
import type { Conversation, Episode, Show } from "@core/schema";
import { buildCatalog } from "@podcasts/lib/catalog";
import type { SiteData } from "@podcasts/site-data";

export function makeShow(overrides: Partial<Show> & Pick<Show, "slug">): Show {
  return {
    name: overrides.slug,
    host: "Host",
    links: {},
    image: `shows/${overrides.slug}.webp`,
    extra: {},
    ...overrides,
  };
}

export function makeEpisode(overrides: Partial<Episode> & Pick<Episode, "slug">): Episode {
  return {
    title: `Title of ${overrides.slug}`,
    guests: [],
    show: "alpha",
    url: `https://example.com/${overrides.slug}`,
    addedAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
    tags: [],
    summary: [],
    notes: "",
    extra: {},
    ...overrides,
  };
}

export function makeSiteData(
  shows: readonly Show[],
  episodes: readonly Episode[],
  conversations: Record<string, Conversation[]> = {},
  load: (slug: string) => Promise<Conversation[]> = async (slug) => conversations[slug] ?? [],
): SiteData {
  return {
    catalog: buildCatalog(shows, episodes),
    conversations: { has: (slug) => slug in conversations, load },
  };
}
