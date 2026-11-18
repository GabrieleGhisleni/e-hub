/**
 * File locations (Node only). Data and public dirs default to `<repo>/data`
 * and `<repo>/public`; tests and dry runs override them with
 * `E_PODCASTS_DATA_DIR` / `E_PODCASTS_PUBLIC_DIR` (read on every call).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userScopedDir } from "@ehub/store";
import { Slug } from "./schema";
import { ValidationError } from "./errors";

export const DATA_DIR_ENV = "E_PODCASTS_DATA_DIR";
export const PUBLIC_DIR_ENV = "E_PODCASTS_PUBLIC_DIR";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function dataDir(): string {
  return path.resolve(process.env[DATA_DIR_ENV] || path.join(REPO_ROOT, "data"));
}

export function publicDir(): string {
  return path.resolve(process.env[PUBLIC_DIR_ENV] || path.join(REPO_ROOT, "public"));
}

/** Throws `ValidationError` unless `slug` matches the slug regex. Call before building any path from a slug. */
export function assertSlug(slug: string, what = "slug"): string {
  const result = Slug.safeParse(slug);
  if (!result.success) {
    throw new ValidationError(
      `invalid ${what} '${slug}'`,
      result.error.issues.map((issue) => issue.message),
    );
  }
  return result.data;
}

export const dirs = {
  shows: () => path.join(dataDir(), "shows"),
  episodes: () => path.join(dataDir(), "episodes"),
  conversations: () => path.join(dataDir(), "conversations"),
  // Disk-only files (not in Turso): one folder per user in the hosted setup.
  transcripts: () => path.join(userScopedDir(dataDir()), "transcripts"),
  showImages: () => path.join(publicDir(), "shows"),
};

export const files = {
  show: (slug: string) => path.join(dirs.shows(), `${assertSlug(slug, "show slug")}.json`),
  episode: (slug: string) => path.join(dirs.episodes(), `${assertSlug(slug, "episode slug")}.json`),
  conversations: (slug: string) =>
    path.join(dirs.conversations(), `${assertSlug(slug, "episode slug")}.json`),
  transcript: (slug: string) =>
    path.join(dirs.transcripts(), `${assertSlug(slug, "episode slug")}.json`),
  /** Absolute path of `public/shows/<slug>.webp`. */
  showImage: (slug: string) =>
    path.join(dirs.showImages(), `${assertSlug(slug, "show slug")}.webp`),
};

/** Site-relative path stored in `Show.image`. */
export function showImageRelativePath(slug: string): string {
  return `shows/${assertSlug(slug, "show slug")}.webp`;
}
