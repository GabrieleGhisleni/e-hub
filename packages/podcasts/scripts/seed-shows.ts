/**
 * Creates (or refreshes) the hand-entered shows of DESIGN.md §4.1 through
 * core: reads each RSS feed, takes the channel cover (`<itunes:image>`), and
 * calls `createShow` with it, which writes `data/shows/<slug>.json` and
 * `public/shows/<slug>.webp`.
 *
 *   pnpm exec tsx scripts/seed-shows.ts [slug…]
 *
 * The show definitions live in src/core/ingest/known-shows.ts (ingest uses
 * them to recognise these shows); URLs verified on 2026-11-09 (see
 * docs/progress/phase-3.md).
 */
import { fetchFeedCover } from "../src/core/ingest/feed";
import { createHttp } from "../src/core/ingest/http";
import { KNOWN_SHOWS } from "../src/core/ingest/known-shows";
import { createShow } from "../src/core/shows";

const http = createHttp();
const wanted = new Set(process.argv.slice(2));
for (const { show } of KNOWN_SHOWS) {
  if (wanted.size > 0 && !wanted.has(show.slug)) continue;
  const cover = await fetchFeedCover(http, show.feedUrl);
  const saved = await createShow(show, { imageSource: cover, overwrite: true });
  console.log(
    `${saved.slug}: data/shows/${saved.slug}.json, public/${saved.image} (cover ${cover})`,
  );
}
