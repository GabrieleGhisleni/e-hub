/**
 * The hand-entered shows of DESIGN.md §4.1 (feeds and channel URLs verified
 * on 2026-11-09, see docs/progress/phase-3.md). Ingest recognises them by the
 * oEmbed `author_url` (or by site) even when `data/shows/<slug>.json` does not
 * exist yet, and then creates the show from this definition.
 * `scripts/seed-shows.ts` writes the same definitions.
 */
import type { ShowInput } from "../schema";
import { normalizeUrlForComparison } from "../urls";

export type KnownSource = "lex" | "huberman";

export interface KnownShow {
  source: KnownSource;
  show: ShowInput & { slug: string; feedUrl: string; youtubeAuthorUrl: string };
}

export const KNOWN_SHOWS: readonly KnownShow[] = [
  {
    source: "lex",
    show: {
      slug: "lex-fridman",
      name: "Lex Fridman Podcast",
      host: "Lex Fridman",
      links: {
        website: "https://lexfridman.com/podcast/",
        youtube: "https://www.youtube.com/@lexfridman",
      },
      youtubeAuthorUrl: "https://www.youtube.com/@lexfridman",
      feedUrl: "https://lexfridman.com/feed/podcast/",
    },
  },
  {
    source: "huberman",
    show: {
      slug: "huberman-lab",
      name: "Huberman Lab",
      host: "Andrew Huberman",
      links: {
        website: "https://www.hubermanlab.com/",
        youtube: "https://www.youtube.com/@hubermanlab",
      },
      youtubeAuthorUrl: "https://www.youtube.com/@hubermanlab",
      feedUrl: "https://feeds.megaphone.fm/hubermanlab",
    },
  },
];

export function knownShowBySource(source: KnownSource): KnownShow {
  return KNOWN_SHOWS.find((known) => known.source === source)!;
}

/** The known show whose channel matches an oEmbed `author_url`. */
export function knownShowByAuthorUrl(authorUrl: string): KnownShow | undefined {
  const wanted = normalizeUrlForComparison(authorUrl).toLowerCase();
  return KNOWN_SHOWS.find(
    (known) => normalizeUrlForComparison(known.show.youtubeAuthorUrl).toLowerCase() === wanted,
  );
}
