/**
 * Site data of the podcasts module: shows and episodes come from the API at runtime (one request), conversations per
 * episode (docs/hosting.md).
 */
import type { Conversation } from "@core/schema";
import { buildCatalog } from "@podcasts/lib/catalog";
import type { SiteData } from "@podcasts/site-data";

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

/** Shows and episodes come from the API at runtime (one request), conversations per episode. */
export async function loadRemoteSiteData(): Promise<SiteData> {
  const response = await fetch("/api/podcasts/catalog", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`GET /api/podcasts/catalog → HTTP ${response.status}`);
  const { shows, episodes } = (await response.json()) as { shows: unknown[]; episodes: unknown[] };
  return {
    catalog: buildCatalog(shows, episodes),
    conversations: {
      has: () => true,
      load: async (slug) => {
        const res = await fetch(`/api/podcasts/episodes/${encodeURIComponent(slug)}/conversations`);
        if (!res.ok) return [];
        return toConversations(((await res.json()) as { conversations?: unknown }).conversations);
      },
    },
  };
}
