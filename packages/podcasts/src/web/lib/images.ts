/**
 * Episode images (DESIGN.md §6.2): YouTube thumbnails linked directly, the
 * show image (in the repo, under `public/shows/`) as fallback.
 *
 * - list: `hqdefault.jpg` (always exists) → show image
 * - detail: `maxresdefault.jpg` (missing for many videos) → `hqdefault.jpg` → show image
 */
import type { Episode, Show } from "@core/schema";
import { PODCASTS_BASE } from "@podcasts/lib/paths";

export type ThumbnailQuality = "hqdefault" | "maxresdefault";

export interface ImageCandidate {
  readonly src: string;
  /** `thumbnail` = 16:9 video frame; `show` = square cover, shown letterboxed. */
  readonly kind: "thumbnail" | "show";
}

export function youtubeThumbnailUrl(youtubeId: string, quality: ThumbnailQuality): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/${quality}.jpg`;
}

/** `show.image` is relative to the site base (e.g. `shows/lex-fridman.webp`). */
export function showImageUrl(
  show: Pick<Show, "image"> | undefined,
  base: string = PODCASTS_BASE,
): string | undefined {
  if (!show?.image) return undefined;
  return `${base.endsWith("/") ? base : `${base}/`}${show.image}`;
}

export function episodeImageCandidates(
  episode: Pick<Episode, "youtubeId">,
  show: Pick<Show, "image"> | undefined,
  variant: "list" | "detail",
  base?: string,
): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  if (episode.youtubeId) {
    if (variant === "detail") {
      candidates.push({
        src: youtubeThumbnailUrl(episode.youtubeId, "maxresdefault"),
        kind: "thumbnail",
      });
    }
    candidates.push({
      src: youtubeThumbnailUrl(episode.youtubeId, "hqdefault"),
      kind: "thumbnail",
    });
  }
  const showSrc = showImageUrl(show, base);
  if (showSrc) candidates.push({ src: showSrc, kind: "show" });
  return candidates;
}

/**
 * A missing YouTube thumbnail may still "load": i.ytimg.com answers 404 with
 * a 120×90 grey placeholder, which some browsers render without an `error`
 * event. Real thumbnails are at least 320 px wide.
 */
export function isYoutubePlaceholder(src: string, naturalWidth: number): boolean {
  return src.startsWith("https://i.ytimg.com/") && naturalWidth > 0 && naturalWidth <= 120;
}
