// Italian messages for LLM call failures, shown in the chat panel. Server only.
// The AI SDK wraps provider failures: a RetryError (after its retries) holds the last APICallError.

import { APICallError, RetryError } from "ai";

const NETWORK_ERROR_PATTERN = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|ETIMEDOUT/i;

/** The error followed by its `cause` chain (a few levels deep). */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 6) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** Unwraps RetryError (its last error, else the last of its errors). */
function unwrapRetry(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5 && RetryError.isInstance(current); depth++) {
    current = current.lastError ?? current.errors.at(-1) ?? current.cause;
  }
  return current;
}

function isAbort(error: unknown): boolean {
  return causeChain(error).some((item) => item instanceof Error && item.name === "AbortError");
}

function isNetworkError(error: unknown): boolean {
  return causeChain(error).some(
    (item) =>
      item instanceof Error &&
      (NETWORK_ERROR_PATTERN.test(item.message) || NETWORK_ERROR_PATTERN.test((item as { code?: string }).code ?? "")),
  );
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/** The router's JSON error body, when it has one: `{ error: { message, retry_in_seconds } }`. */
function routerError(error: { responseBody?: string; data?: unknown }): { message?: string; retryInSeconds?: number } {
  // The raw body first: the provider's parsed `data` can drop fields such as retry_in_seconds.
  let body: unknown = error.data;
  if (error.responseBody) {
    try {
      body = JSON.parse(error.responseBody);
    } catch {
      // Not JSON: keep `data`, if any.
    }
  }
  const inner = (body as { error?: unknown } | null)?.error;
  if (typeof inner === "string") return { message: inner };
  if (inner === null || typeof inner !== "object") return {};
  const { message, retry_in_seconds: retry } = inner as { message?: unknown; retry_in_seconds?: unknown };
  return {
    message: typeof message === "string" && message !== "" ? message : undefined,
    retryInSeconds: typeof retry === "number" && Number.isFinite(retry) ? retry : undefined,
  };
}

/** Seconds to wait before retrying: the `retry-after` header first, then the router's `retry_in_seconds`. */
function retryAfterSeconds(error: APICallError): number | undefined {
  const header = Number(headerValue(error.responseHeaders, "retry-after"));
  if (headerValue(error.responseHeaders, "retry-after") !== undefined && Number.isFinite(header) && header >= 0) {
    return Math.ceil(header);
  }
  const retry = routerError(error).retryInSeconds;
  return retry === undefined ? undefined : Math.ceil(Math.max(0, retry));
}

function describeApiError(error: APICallError): string {
  const status = error.statusCode;
  if (status === 503 || status === 429) {
    const seconds = retryAfterSeconds(error);
    const wait = seconds === undefined ? "" : ` Riprova tra ${seconds} secondi.`;
    return `Il modello non è disponibile in questo momento (limiti dei piani gratuiti).${wait}`;
  }
  if (status === 401) return "Chiave API non valida: controlla EHUB_AI_API_KEY in .env.local.";
  if (status === 404) return "Modello non trovato: controlla EHUB_AI_MODEL.";
  const routerMessage = routerError(error).message;
  return `Errore del modello (HTTP ${status})${routerMessage ? `: ${routerMessage}` : ""}`;
}

/**
 * Describes a failed LLM call for the chat panel, in Italian.
 * `baseUrl` (the model endpoint) is named in the network-error message when given.
 */
export function describeLlmError(error: unknown, options: { baseUrl?: string } = {}): string {
  if (isAbort(error)) return "Risposta interrotta.";

  const last = unwrapRetry(error);
  if (APICallError.isInstance(last) && last.statusCode !== undefined) return describeApiError(last);

  if (isNetworkError(last)) {
    const where = options.baseUrl ? ` (${options.baseUrl})` : "";
    return `Il server del modello non risponde: è avviato?${where}`;
  }

  if (last instanceof Error && last.message) return last.message;
  if (typeof last === "string" && last !== "") return last;
  return "Errore inatteso.";
}
