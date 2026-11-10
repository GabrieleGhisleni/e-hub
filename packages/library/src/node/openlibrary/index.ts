import { RateLimiter } from "./rate-limiter.ts";

export { RateLimiter } from "./rate-limiter.ts";

export const OPEN_LIBRARY_USER_AGENT = "e-library/1.0 (personal library manager)";
const TIMEOUT_MS = 10_000;
/** Open Library answers with a ~43-byte 1x1 GIF for missing covers when `default=false` is ignored. */
const MIN_COVER_BYTES = 1024;

export interface OpenLibraryOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  limiter?: Pick<RateLimiter, "acquire">;
  /** Called with a short reason when a request fails or finds nothing useful. */
  onFailure?: (reason: string) => void;
  timeoutMs?: number;
}

export interface OpenLibraryMatch {
  coverId: number;
  matchedBy: "isbn" | "title-author";
  needsConfirmation: boolean;
  olTitle?: string;
  olAuthors?: string[];
}

export interface OpenLibraryQuery {
  isbn?: string;
  title?: string;
  authors?: string[];
}

export type OpenLibraryFindResult =
  | { match: OpenLibraryMatch; failures: string[] }
  | { match: null; failures: string[] };

class Fail extends Error {}

async function request(url: string, opts: OpenLibraryOptions): Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  await opts.limiter?.acquire();
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    return await doFetch(url, {
      signal,
      headers: { "User-Agent": OPEN_LIBRARY_USER_AGENT, Accept: "application/json, image/*" },
      redirect: "follow",
    });
  } catch (error) {
    const reason = timeout.aborted
      ? "timeout"
      : opts.signal?.aborted
        ? "aborted"
        : `network error: ${(error as Error).message}`;
    throw new Fail(reason);
  }
}

async function getJson(url: string, opts: OpenLibraryOptions): Promise<unknown | null> {
  const response = await request(url, opts);
  if (response.status === 404) return null;
  if (!response.ok) throw new Fail(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Fail("invalid JSON");
  }
}

function firstCoverId(covers: unknown): number | undefined {
  if (!Array.isArray(covers)) return undefined;
  return covers.find((c): c is number => typeof c === "number" && Number.isInteger(c) && c > 0);
}

function norm(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Looks up a cover id by ISBN first, then title+author. Never throws; see `failures` for why it found nothing. */
export async function findOpenLibraryCoverDetailed(
  query: OpenLibraryQuery,
  opts: OpenLibraryOptions = {},
): Promise<OpenLibraryFindResult> {
  const failures: string[] = [];
  const fail = (reason: string) => {
    failures.push(reason);
    opts.onFailure?.(reason);
  };
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (error) {
      fail(`${label}: ${error instanceof Fail ? error.message : (error as Error).message}`);
      return undefined;
    }
  };

  const isbn = query.isbn?.replace(/[\s-]/g, "");
  if (isbn) {
    const edition = await attempt("isbn", () =>
      getJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`, opts),
    );
    const direct = firstCoverId((edition as { covers?: unknown } | null | undefined)?.covers);
    if (direct !== undefined) {
      const title = (edition as { title?: unknown }).title;
      return {
        match: {
          coverId: direct,
          matchedBy: "isbn",
          needsConfirmation: false,
          ...(typeof title === "string" ? { olTitle: title } : {}),
        },
        failures,
      };
    }
    const search = await attempt("isbn-search", () =>
      getJson(
        `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=key,title,author_name,cover_i&limit=3`,
        opts,
      ),
    );
    const docs = (search as { docs?: unknown } | null | undefined)?.docs;
    if (Array.isArray(docs)) {
      for (const doc of docs as Record<string, unknown>[]) {
        const id =
          typeof doc["cover_i"] === "number" && doc["cover_i"] > 0 ? doc["cover_i"] : undefined;
        if (id !== undefined) {
          return {
            match: {
              coverId: id,
              matchedBy: "isbn",
              needsConfirmation: false,
              ...(typeof doc["title"] === "string" ? { olTitle: doc["title"] } : {}),
              ...(Array.isArray(doc["author_name"])
                ? {
                    olAuthors: (doc["author_name"] as unknown[]).filter(
                      (a): a is string => typeof a === "string",
                    ),
                  }
                : {}),
            },
            failures,
          };
        }
      }
    }
  }

  const title = query.title?.trim();
  if (title) {
    const params = new URLSearchParams({ title });
    const author = query.authors?.find((a) => a.trim());
    if (author) params.set("author", author.trim());
    params.set("limit", "5");
    params.set("fields", "key,title,author_name,cover_i,language");
    const search = await attempt("title-author", () =>
      getJson(`https://openlibrary.org/search.json?${params.toString()}`, opts),
    );
    const docs = (search as { docs?: unknown } | null | undefined)?.docs;
    if (Array.isArray(docs)) {
      const wanted = norm(title);
      const candidates = (docs as Record<string, unknown>[]).filter(
        (d) => typeof d["cover_i"] === "number" && d["cover_i"] > 0,
      );
      // Prefer a doc whose title matches; otherwise the top-ranked doc with a cover.
      const best =
        candidates.find((d) => typeof d["title"] === "string" && norm(d["title"]) === wanted) ??
        candidates[0];
      if (best) {
        return {
          match: {
            coverId: best["cover_i"] as number,
            matchedBy: "title-author",
            needsConfirmation: true,
            ...(typeof best["title"] === "string" ? { olTitle: best["title"] } : {}),
            ...(Array.isArray(best["author_name"])
              ? {
                  olAuthors: (best["author_name"] as unknown[]).filter(
                    (a): a is string => typeof a === "string",
                  ),
                }
              : {}),
          },
          failures,
        };
      }
    }
  }
  if (failures.length === 0) failures.push("no cover found");
  return { match: null, failures };
}

/** Same lookup, returning only the match (or null). Failure reasons go to `opts.onFailure`. */
export async function findOpenLibraryCover(
  query: OpenLibraryQuery,
  opts: OpenLibraryOptions = {},
): Promise<OpenLibraryMatch | null> {
  return (await findOpenLibraryCoverDetailed(query, opts)).match;
}

/** Downloads the large cover; null when there is none (404, tiny placeholder) or on any failure. */
export async function downloadOpenLibraryCover(
  coverId: number,
  opts: OpenLibraryOptions = {},
): Promise<Uint8Array | null> {
  try {
    const response = await request(
      `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`,
      opts,
    );
    if (!response.ok) {
      if (response.status !== 404) opts.onFailure?.(`cover: HTTP ${response.status}`);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < MIN_COVER_BYTES) {
      opts.onFailure?.("cover: placeholder image");
      return null;
    }
    return bytes;
  } catch (error) {
    opts.onFailure?.(`cover: ${(error as Error).message}`);
    return null;
  }
}
