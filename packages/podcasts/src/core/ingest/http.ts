/**
 * Network access for ingest, behind an injectable `fetch`-like function so
 * every parser and flow can be tested offline. Generic User-Agent, timeouts,
 * no retries (DESIGN.md §6; personal, low-volume use).
 */

/** The subset of `fetch` ingest uses. Tests pass a fake that serves fixtures. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: "follow" },
) => Promise<Response>;

export const USER_AGENT = "e-podcasts/1.0 (personal podcast catalogue)";
export const DEFAULT_TIMEOUT_MS = 30_000;

/** HTTP status other than 2xx, or a network failure / timeout (`status` 0). */
export class HttpError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  accept?: string;
}

export interface Http {
  /** Response body as text. Throws `HttpError` (incl. 404). */
  text(url: string, options?: RequestOptions): Promise<string>;
  /** Like `text`, but resolves `undefined` on 404/410. */
  textIfExists(url: string, options?: RequestOptions): Promise<string | undefined>;
  json(url: string, options?: RequestOptions): Promise<unknown>;
  bytes(url: string, options?: RequestOptions & { maxBytes?: number }): Promise<Uint8Array>;
}

export function createHttp(fetchImpl: FetchLike = globalThis.fetch): Http {
  async function get(url: string, options: RequestOptions = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: options.accept ?? "*/*" },
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (error) {
      const reason =
        (error as Error).name === "TimeoutError" ? "timed out" : (error as Error).message;
      throw new HttpError(url, 0, `request to ${url} failed: ${reason}`);
    }
    if (!response.ok) throw new HttpError(url, response.status);
    return response;
  }

  return {
    async text(url, options) {
      return (await get(url, options)).text();
    },
    async textIfExists(url, options) {
      try {
        return await (await get(url, options)).text();
      } catch (error) {
        if (error instanceof HttpError && (error.status === 404 || error.status === 410))
          return undefined;
        throw error;
      }
    },
    async json(url, options) {
      const body = await (await get(url, { accept: "application/json", ...options })).text();
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new HttpError(url, 200, `invalid JSON from ${url}`);
      }
    },
    async bytes(url, options = {}) {
      const response = await get(url, options);
      const max = options.maxBytes ?? 25 * 1024 * 1024;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > max) throw new HttpError(url, 200, `response too large from ${url}`);
      return bytes;
    },
  };
}
