/**
 * Show creation and images (Node only). Images are downloaded once, at show
 * creation, and stored in the repo as `public/shows/<slug>.webp`
 * (DESIGN.md §4.1, §6.2).
 */
import sharp from "sharp";
import { AlreadyExistsError, ValidationError } from "./errors";
import { writeFileAtomic } from "./json-file";
import { assertSlug, files, showImageRelativePath } from "./paths";
import { Show, formatIssues, type ShowInput } from "./schema";
import { listShows, readShowIfExists, withLock, writeShow } from "./store";
import { normalizeUrlForComparison } from "./urls";

/** Side of the square show image, in pixels. */
export const SHOW_IMAGE_SIZE = 512;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export type ImageSource = string | URL | Uint8Array;

async function loadImage(source: ImageSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  const url = source.toString();
  if (!/^https?:\/\//.test(url))
    throw new ValidationError(`image source must be an http(s) URL or bytes, got '${url}'`);
  const response = await fetch(url, {
    headers: { "user-agent": "e-podcasts/1.0 (personal podcast catalogue)" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`image download failed: HTTP ${response.status} for ${url}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new Error(`image too large (${length} bytes): ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new Error(`image too large (${bytes.length} bytes): ${url}`);
  return bytes;
}

/**
 * Downloads (or takes) an image, converts it to a square `SHOW_IMAGE_SIZE` px
 * webp (center crop) and writes `public/shows/<slug>.webp` atomically.
 * Returns the site-relative path to store in `Show.image` (`shows/<slug>.webp`).
 */
export async function saveShowImage(
  slug: string,
  source: ImageSource,
  options: { size?: number } = {},
): Promise<string> {
  assertSlug(slug, "show slug");
  const size = options.size ?? SHOW_IMAGE_SIZE;
  const input = await loadImage(source);
  let webp: Buffer;
  try {
    webp = await sharp(input)
      .rotate()
      .resize(size, size, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    throw new ValidationError(`cannot convert image for show '${slug}'`, [
      (error as Error).message,
    ]);
  }
  await writeFileAtomic(files.showImage(slug), webp);
  return showImageRelativePath(slug);
}

export interface CreateShowOptions {
  /** Cover to download/convert into `public/shows/<slug>.webp` (feed `<itunes:image>` or channel avatar). */
  imageSource?: ImageSource;
  /** Replace an existing show file (default: `AlreadyExistsError`). */
  overwrite?: boolean;
}

/**
 * Creates `data/shows/<slug>.json`, after saving the image if `imageSource`
 * is given (then `image` is set to `shows/<slug>.webp`). Validates first.
 */
export async function createShow(input: ShowInput, options: CreateShowOptions = {}): Promise<Show> {
  const slug = assertSlug(input.slug, "show slug");
  return withLock(`show:${slug}`, async () => {
    if (!options.overwrite && (await readShowIfExists(slug)))
      throw new AlreadyExistsError(`show '${slug}' already exists`);
    // Validate before downloading anything.
    const check = Show.safeParse(input);
    if (!check.success) throw new ValidationError("invalid show", formatIssues(check.error));
    const image =
      options.imageSource === undefined
        ? input.image
        : await saveShowImage(slug, options.imageSource);
    return writeShow({ ...input, image });
  });
}

/** The show whose `youtubeAuthorUrl` matches an oEmbed `author_url` (one generic show per channel). */
export async function findShowByYoutubeAuthorUrl(authorUrl: string): Promise<Show | undefined> {
  const wanted = normalizeUrlForComparison(authorUrl).toLowerCase();
  return (await listShows()).find(
    (show) =>
      show.youtubeAuthorUrl !== undefined &&
      normalizeUrlForComparison(show.youtubeAuthorUrl).toLowerCase() === wanted,
  );
}
