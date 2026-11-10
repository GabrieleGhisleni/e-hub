/** URL layout of the generated site data, shared by the Vite plugin and the SPA. No Node APIs. */

export const DATA_DIR_NAME = "data";
export const INDEX_PATH = "data/index.json";
export const BOOKS_PATH_PREFIX = "data/books/";
export const COVERS_PATH_PREFIX = "data/covers/";
/** Vite dev HMR custom event sent when anything under data/ changes. */
export const DATA_CHANGED_EVENT = "elib:data-changed";

/** `/e-library` or `e-library/` → `/e-library/`; "" → `/`. */
export function normalizeBasePath(basePath: string): string {
  let base = basePath.trim();
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return base;
}

/** Published path (relative to the output dir) of a book detail file. */
export function bookPath(id: string): string {
  return `${BOOKS_PATH_PREFIX}${id}.json`;
}

export function coverPath(fileName: string): string {
  return `${COVERS_PATH_PREFIX}${fileName}`;
}

/** `<id>.<8 hex>.webp`. */
export function coverFileName(id: string, hash: string): string {
  return `${id}.${hash}.webp`;
}

export interface SiteDataUrls {
  indexUrl: string;
  bookUrl(id: string): string;
  coverUrl(fileName: string): string;
}

export function siteDataUrls(basePath: string): SiteDataUrls {
  const base = normalizeBasePath(basePath);
  return {
    indexUrl: `${base}${INDEX_PATH}`,
    bookUrl: (id) => `${base}${bookPath(id)}`,
    coverUrl: (fileName) => `${base}${coverPath(fileName)}`,
  };
}
