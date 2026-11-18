/**
 * Site data store: `index.json` fetched once, `books/<id>.json` on demand, both cached in memory.
 *
 * - Same URLs in dev (Vite plugin middleware) and on Pages (static files), see `@shared/site-urls`.
 * - Dev: the Vite plugin sends `elib:data-changed` when anything under data/ changes; we refetch everything
 *   already loaded, keeping the current data on screen while it reloads (no skeleton flash).
 * - `refreshSiteData()` is the hook for the admin UI (W4a): call it after a write to see the new data.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { BookCard, BookDetail, SiteIndex } from "@shared/schema";
import { DATA_CHANGED_EVENT, siteDataUrls } from "@shared/site-urls";

export type Resource<T> =
  | { status: "idle" }
  | { status: "loading" }
  /** `refreshing`: a background refetch is running (the data shown may be about to change). */
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "not-found" }
  | { status: "error"; error: Error };

export class HttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`GET ${url} → HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

// Hosted build: the API serves the same documents (and absolute cover URLs) at runtime; otherwise static files.
const HOSTED = import.meta.env.VITE_HOSTED === "1";
const urls = HOSTED
  ? {
      indexUrl: "/api/library/site/index.json",
      bookUrl: (id: string) => `/api/library/site/books/${id}.json`,
      coverUrl: (fileName: string) => `/api/library/site/covers/${fileName}`,
    }
  : siteDataUrls(import.meta.env.BASE_URL);

const IDLE = { status: "idle" } as const;
let indexState: Resource<SiteIndex> = IDLE;
const detailStates = new Map<string, Resource<BookDetail>>();
const listeners = new Set<() => void>();
/** Bumped by `refreshSiteData()`: responses of older requests are dropped. */
let generation = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchJson(url: string): Promise<unknown> {
  // "no-cache" = revalidate (ETag/304 on Pages): a new deploy shows up without waiting for max-age.
  const response = await fetch(url, { cache: "no-cache", headers: { Accept: "application/json" } });
  if (!response.ok) throw new HttpError(url, response.status);
  return response.json();
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isSiteIndex(value: unknown): value is SiteIndex {
  const v = value as Partial<SiteIndex> | null;
  return !!v && Array.isArray(v.books) && Array.isArray(v.topics);
}

function isBookDetail(value: unknown, id: string): value is BookDetail {
  const v = value as Partial<BookDetail> | null;
  return !!v && v.id === id && typeof v.title === "string" && Array.isArray(v.authors);
}

// ---------------------------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------------------------

let indexRequest: Promise<void> | null = null;

/** Loads index.json unless it is already loaded/loading. `force` refetches in the background. */
export function loadIndex(force = false): Promise<void> {
  if (indexRequest && !force) return indexRequest;
  if (!force && indexState.status === "ready") return Promise.resolve();
  const gen = generation;
  const previous = indexState;
  indexState =
    previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" };
  emit();
  const request = fetchJson(urls.indexUrl)
    .then((json) => {
      if (!isSiteIndex(json)) throw new Error("index.json has an unexpected shape");
      if (gen !== generation) return;
      indexState = { status: "ready", data: json, refreshing: false };
    })
    .catch((error: unknown) => {
      if (gen !== generation) return;
      // A failed background refresh keeps what is on screen.
      indexState =
        previous.status === "ready"
          ? { ...previous, refreshing: false }
          : { status: "error", error: asError(error) };
      if (previous.status === "ready") console.warn("[elib] index refresh failed", error);
    })
    .finally(() => {
      if (indexRequest === request) indexRequest = null;
      emit();
    });
  indexRequest = request;
  return request;
}

const detailRequests = new Map<string, Promise<void>>();

/** Loads books/<id>.json unless cached. 404 → `not-found`. `force` refetches in the background. */
export function loadBook(id: string, force = false): Promise<void> {
  const pending = detailRequests.get(id);
  if (pending && !force) return pending;
  const previous = detailStates.get(id) ?? IDLE;
  if (!force && (previous.status === "ready" || previous.status === "not-found")) {
    return Promise.resolve();
  }
  const gen = generation;
  detailStates.set(
    id,
    previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" },
  );
  emit();
  const request = fetchJson(urls.bookUrl(id))
    .then((json) => {
      if (!isBookDetail(json, id)) throw new Error(`books/${id}.json has an unexpected shape`);
      if (gen !== generation) return;
      detailStates.set(id, { status: "ready", data: json, refreshing: false });
    })
    .catch((error: unknown) => {
      if (gen !== generation) return;
      if (error instanceof HttpError && error.status === 404) {
        detailStates.set(id, { status: "not-found" });
      } else if (previous.status === "ready") {
        detailStates.set(id, { ...previous, refreshing: false });
        console.warn(`[elib] refresh of book ${id} failed`, error);
      } else {
        detailStates.set(id, { status: "error", error: asError(error) });
      }
    })
    .finally(() => {
      if (detailRequests.get(id) === request) detailRequests.delete(id);
      emit();
    });
  detailRequests.set(id, request);
  return request;
}

/**
 * Refetches the index and every book detail already requested, keeping current data visible meanwhile.
 * Used by the dev HMR event and by the admin UI after a write (W4a).
 */
export function refreshSiteData(): Promise<void> {
  generation += 1;
  indexRequest = null;
  detailRequests.clear();
  const jobs: Promise<void>[] = [];
  if (indexState.status !== "idle") jobs.push(loadIndex(true));
  for (const id of detailStates.keys()) jobs.push(loadBook(id, true));
  return Promise.all(jobs).then(() => undefined);
}

/** Warms the cache for a book page (hover/focus on a card). Errors are ignored here. */
export function prefetchBook(id: string): void {
  void loadBook(id);
}

if (import.meta.hot) {
  import.meta.hot.on(DATA_CHANGED_EVENT, () => {
    void refreshSiteData();
  });
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

export interface ResourceHook<T> {
  state: Resource<T>;
  /** The data when ready (also while refreshing), else undefined. */
  data: T | undefined;
  retry: () => void;
}

/** index.json (topics + book cards). Starts loading on first use. */
export function useSiteIndex(): ResourceHook<SiteIndex> {
  const state = useSyncExternalStore(subscribe, () => indexState);
  useEffect(() => {
    void loadIndex();
  }, []);
  const retry = useCallback(() => void loadIndex(true), []);
  return { state, data: state.status === "ready" ? state.data : undefined, retry };
}

/** books/<id>.json. Starts loading on first use. */
export function useBookDetail(id: string | null): ResourceHook<BookDetail> {
  const state = useSyncExternalStore(subscribe, () =>
    id === null ? IDLE : (detailStates.get(id) ?? IDLE),
  );
  useEffect(() => {
    if (id !== null) void loadBook(id);
  }, [id]);
  const retry = useCallback(() => {
    if (id !== null) void loadBook(id, true);
  }, [id]);
  return { state, data: state.status === "ready" ? state.data : undefined, retry };
}

/** Card of a book from the loaded index (instant title/cover on the book page). */
export function findCard(index: SiteIndex | undefined, id: string): BookCard | undefined {
  return index?.books.find((book) => book.id === id);
}

/** Topic label from the loaded index, falling back to the ID. */
export function topicLabel(index: SiteIndex | undefined, topicId: string): string {
  return index?.topics.find((t) => t.id === topicId)?.label ?? topicId;
}
