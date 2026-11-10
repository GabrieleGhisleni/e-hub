/**
 * Which source a pasted URL belongs to (DESIGN.md §6). Pure.
 *
 * - `lexfridman.com/<slug>` (episode page, or its `<slug>-transcript` page)
 * - `hubermanlab.com/episode/<slug>`
 * - YouTube: `watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/` (extra params ignored)
 */
import { ValidationError } from "../errors";
import { extractYoutubeId } from "../urls";

export type RecognizedUrl =
  | { kind: "lex"; /** Episode page slug (without `-transcript`). */ slug: string; url: string }
  | { kind: "huberman"; slug: string; url: string }
  | { kind: "youtube"; youtubeId: string; url: string };

/** Lex site paths that are not episode pages. */
const LEX_RESERVED = new Set([
  "podcast",
  "category",
  "feed",
  "tag",
  "author",
  "page",
  "ama",
  "survey",
  "contact",
  "hiring",
  "sponsors",
  "s",
  "wordpress",
  "wp-content",
  "wp-admin",
  "wp-json",
  "comments",
  "search",
]);

export function canonicalYoutubeUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

export function lexEpisodeUrl(slug: string): string {
  return `https://lexfridman.com/${slug}`;
}

export function hubermanEpisodeUrl(slug: string): string {
  return `https://www.hubermanlab.com/episode/${slug}`;
}

const SUPPORTED =
  "supported: lexfridman.com/<episode>, hubermanlab.com/episode/<episode>, YouTube video URLs";

/** Recognises a URL or throws `ValidationError` (unsupported or malformed). */
export function recognizeUrl(input: string): RecognizedUrl {
  const text = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ValidationError(`not a valid URL: '${input}'`, [SUPPORTED]);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new ValidationError(`not an http(s) URL: '${input}'`, [SUPPORTED]);
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  const youtubeId = extractYoutubeId(parsed.toString());
  if (youtubeId) return { kind: "youtube", youtubeId, url: canonicalYoutubeUrl(youtubeId) };

  if (host === "lexfridman.com") {
    const [first, ...rest] = segments;
    if (first && rest.length === 0 && !LEX_RESERVED.has(first) && /^[a-z0-9-]+$/i.test(first)) {
      const slug = first.toLowerCase().replace(/-transcript$/, "");
      if (slug) return { kind: "lex", slug, url: lexEpisodeUrl(slug) };
    }
    throw new ValidationError(`not a Lex Fridman episode URL: '${input}'`, [
      "expected https://lexfridman.com/<episode> (or its -transcript page)",
    ]);
  }

  if (host === "hubermanlab.com") {
    const [first, second, ...rest] = segments;
    if (first === "episode" && second && rest.length === 0 && /^[a-z0-9-]+$/i.test(second))
      return { kind: "huberman", slug: second.toLowerCase(), url: hubermanEpisodeUrl(second) };
    throw new ValidationError(`not a Huberman Lab episode URL: '${input}'`, [
      "expected https://www.hubermanlab.com/episode/<episode> or the YouTube video URL",
    ]);
  }

  if (["youtube.com", "youtu.be", "music.youtube.com", "youtube-nocookie.com"].includes(host))
    throw new ValidationError(`not a YouTube video URL: '${input}'`, [
      "expected a video link (watch?v=…, youtu.be/…, /live/…, /shorts/…)",
    ]);

  throw new ValidationError(`unsupported URL: '${input}'`, [SUPPORTED]);
}
