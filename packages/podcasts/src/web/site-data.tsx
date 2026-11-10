/**
 * The data the pages read: the in-memory catalog, its search index and the
 * on-demand conversation loader. Provided through context so tests can
 * inject synthetic data instead of the `import.meta.glob` modules (`@podcasts/data`).
 */
import { createContext, use, useMemo, type ReactNode } from "react";
import type { Conversation } from "@core/schema";
import type { Catalog } from "@podcasts/lib/catalog";
import { createEpisodeIndex, type EpisodeIndex } from "@podcasts/lib/search";

export interface ConversationSource {
  /** Whether a conversations file exists for the episode (no file = none). */
  has(slug: string): boolean;
  /** Loads the episode's conversations (oldest first); `[]` when there is no file. */
  load(slug: string): Promise<Conversation[]>;
}

export interface SiteData {
  readonly catalog: Catalog;
  readonly conversations: ConversationSource;
}

interface SiteDataValue extends SiteData {
  readonly index: EpisodeIndex;
}

const SiteDataContext = createContext<SiteDataValue | null>(null);

export function SiteDataProvider({ data, children }: { data: SiteData; children: ReactNode }) {
  const value = useMemo(
    () => ({ ...data, index: createEpisodeIndex(data.catalog.episodes) }),
    [data],
  );
  return <SiteDataContext value={value}>{children}</SiteDataContext>;
}

export function useSiteData(): SiteDataValue {
  const value = use(SiteDataContext);
  if (!value) throw new Error("useSiteData must be used inside <SiteDataProvider>");
  return value;
}
