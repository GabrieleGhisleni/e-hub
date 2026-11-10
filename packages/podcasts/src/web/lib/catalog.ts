/**
 * In-memory catalog of shows and episodes (DESIGN.md §8.1). Pure: the
 * `import.meta.glob` wiring lives in `@podcasts/data`, so tests can build a catalog
 * from synthetic records.
 *
 * Records come from files written by core (already validated, defaults
 * filled in), so they are not re-validated here (that would put zod in the
 * bundle); `tests/data.test.ts` validates the tracked files. This module only
 * guards against a malformed hand-edited file breaking the whole page.
 */
import type { Episode, Show } from "@core/schema";

export interface Catalog {
  /** Newest `addedAt` first (DESIGN.md §8.3). */
  readonly episodes: readonly Episode[];
  /** Sorted by name. */
  readonly shows: readonly Show[];
  readonly episodesBySlug: ReadonlyMap<string, Episode>;
  readonly showsBySlug: ReadonlyMap<string, Show>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Episode record with the schema defaults filled in, or `undefined` if the essentials are missing. */
export function toEpisode(value: unknown): Episode | undefined {
  if (!isRecord(value)) return undefined;
  const { slug, title, show, url, addedAt } = value;
  if (
    typeof slug !== "string" ||
    typeof title !== "string" ||
    typeof show !== "string" ||
    typeof url !== "string" ||
    typeof addedAt !== "string"
  ) {
    return undefined;
  }
  return {
    ...(value as Partial<Episode>),
    slug,
    title,
    show,
    url,
    addedAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : addedAt,
    guests: stringList(value.guests),
    tags: stringList(value.tags),
    summary: stringList(value.summary),
    notes: typeof value.notes === "string" ? value.notes : "",
    extra: isRecord(value.extra) ? value.extra : {},
  };
}

/** Show record with defaults filled in, or `undefined` if slug/name are missing. */
export function toShow(value: unknown): Show | undefined {
  if (!isRecord(value)) return undefined;
  const { slug, name } = value;
  if (typeof slug !== "string" || typeof name !== "string") return undefined;
  return {
    ...(value as Partial<Show>),
    slug,
    name,
    host: typeof value.host === "string" ? value.host : "",
    links: isRecord(value.links) ? (value.links as Show["links"]) : {},
    extra: isRecord(value.extra) ? value.extra : {},
  };
}

/** Newest first; ties broken by slug so the order is stable. */
export function compareByAddedAtDesc(a: Episode, b: Episode): number {
  return b.addedAt.localeCompare(a.addedAt) || a.slug.localeCompare(b.slug);
}

export function buildCatalog(
  showRecords: readonly unknown[],
  episodeRecords: readonly unknown[],
): Catalog {
  const shows = showRecords
    .map(toShow)
    .filter((show): show is Show => show !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
  const episodes = episodeRecords
    .map(toEpisode)
    .filter((episode): episode is Episode => episode !== undefined)
    .sort(compareByAddedAtDesc);
  return {
    episodes,
    shows,
    episodesBySlug: new Map(episodes.map((episode) => [episode.slug, episode])),
    showsBySlug: new Map(shows.map((show) => [show.slug, show])),
  };
}

/** Display name of an episode's show (falls back to the slug if the show file is missing). */
export function showName(catalog: Catalog, slug: string): string {
  return catalog.showsBySlug.get(slug)?.name ?? slug;
}

export interface MonthGroup {
  /** `YYYY-MM` in the viewer's time zone. */
  readonly key: string;
  readonly episodes: readonly Episode[];
}

/** Consecutive episodes grouped by the month of `addedAt` (input order kept). */
export function groupByAddedMonth(
  episodes: readonly Episode[],
  monthOf: (iso: string) => string,
): MonthGroup[] {
  const groups: { key: string; episodes: Episode[] }[] = [];
  for (const episode of episodes) {
    const key = monthOf(episode.addedAt);
    const last = groups.at(-1);
    if (last?.key === key) last.episodes.push(episode);
    else groups.push({ key, episodes: [episode] });
  }
  return groups;
}
