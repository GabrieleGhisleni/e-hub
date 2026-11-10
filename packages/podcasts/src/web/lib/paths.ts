/**
 * In-app paths. The shell mounts this module under `PODCASTS_BASE`, so every
 * absolute link (and `navigate`) must start with it.
 */

/** URL prefix the shell mounts the module under. */
export const PODCASTS_BASE = "/podcasts";

/** Detail page. Trailing slash = the URL of the static `episode/<slug>/index.html` copy (no redirect on Pages). */
export function episodePath(slug: string): string {
  return `${PODCASTS_BASE}/episode/${encodeURIComponent(slug)}/`;
}

/** Home with the given query string (`""` or `"?…"`). */
export function homePath(search = ""): string {
  return `${PODCASTS_BASE}/${search}`;
}
