// describeLlmError: Italian messages for the failures of an LLM call.

import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { describeLlmError } from "../src/server/errors.ts";

const ROUTER_BODY_503 = {
  error: {
    message: "every matching endpoint is cooling down",
    type: "all_providers_busy",
    retry_in_seconds: 78,
    tried: [],
  },
};

function apiError(options: {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  message?: string;
  cause?: unknown;
}) {
  return new APICallError({
    message: options.message ?? `Bad response ${options.statusCode}`,
    url: "http://router.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: options.statusCode,
    responseHeaders: options.headers,
    responseBody: options.body === undefined ? undefined : JSON.stringify(options.body),
    cause: options.cause,
    isRetryable: options.statusCode === 503 || options.statusCode === 429,
  });
}

function retryError(lastError: unknown) {
  return new RetryError({
    message: "Failed after 3 attempts. Last error: ...",
    reason: "maxRetriesExceeded",
    errors: [lastError],
  });
}

describe("describeLlmError", () => {
  it("503 with retry-after: names the free-tier limits and the seconds from the header", () => {
    const error = apiError({ statusCode: 503, headers: { "retry-after": "78" }, body: ROUTER_BODY_503 });
    expect(describeLlmError(error)).toBe(
      "Il modello non è disponibile in questo momento (limiti dei piani gratuiti). Riprova tra 78 secondi.",
    );
  });

  it("429 with retry_in_seconds only in the body: uses the body value", () => {
    const error = apiError({
      statusCode: 429,
      body: { error: { message: "rate limited", retry_in_seconds: 12 } },
    });
    expect(describeLlmError(error)).toBe(
      "Il modello non è disponibile in questo momento (limiti dei piani gratuiti). Riprova tra 12 secondi.",
    );
  });

  it("503 without any retry hint: omits the retry sentence", () => {
    const error = apiError({ statusCode: 503, body: { error: { message: "busy" } } });
    expect(describeLlmError(error)).toBe("Il modello non è disponibile in questo momento (limiti dei piani gratuiti).");
  });

  it("401: points at EHUB_AI_API_KEY", () => {
    const error = apiError({ statusCode: 401, body: { error: { message: "invalid key" } } });
    expect(describeLlmError(error)).toBe("Chiave API non valida: controlla EHUB_AI_API_KEY in .env.local.");
  });

  it("404: points at EHUB_AI_MODEL", () => {
    const error = apiError({ statusCode: 404 });
    expect(describeLlmError(error)).toBe("Modello non trovato: controlla EHUB_AI_MODEL.");
  });

  it("500 with a router message: includes the router message", () => {
    const error = apiError({ statusCode: 500, body: { error: { message: "upstream exploded" } } });
    expect(describeLlmError(error)).toBe("Errore del modello (HTTP 500): upstream exploded");
  });

  it("500 without a router message: reports only the status", () => {
    const error = apiError({ statusCode: 500, body: "<html>oops</html>" });
    expect(describeLlmError(error)).toBe("Errore del modello (HTTP 500)");
  });

  it("network error (fetch failed, ECONNREFUSED): names the endpoint", () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4000"), { code: "ECONNREFUSED" }),
    });
    const error = apiError({ message: "Cannot connect to API: fetch failed", cause: refused });
    expect(describeLlmError(error, { baseUrl: "http://127.0.0.1:4000/v1" })).toBe(
      "Il server del modello non risponde: è avviato? (http://127.0.0.1:4000/v1)",
    );
  });

  it("network error without a base URL: omits the endpoint", () => {
    expect(describeLlmError(new TypeError("fetch failed"))).toBe("Il server del modello non risponde: è avviato?");
  });

  it("abort: says the answer was interrupted", () => {
    expect(describeLlmError(new DOMException("This operation was aborted", "AbortError"))).toBe("Risposta interrotta.");
  });

  it("RetryError wrapping a 503: unwraps to the last APICallError", () => {
    const error = retryError(apiError({ statusCode: 503, headers: { "retry-after": "5" }, body: ROUTER_BODY_503 }));
    expect(describeLlmError(error)).toBe(
      "Il modello non è disponibile in questo momento (limiti dei piani gratuiti). Riprova tra 5 secondi.",
    );
  });

  it("RetryError wrapping a network error: unwraps to the network message", () => {
    const error = retryError(apiError({ message: "Cannot connect to API: fetch failed", cause: new TypeError("fetch failed") }));
    expect(describeLlmError(error, { baseUrl: "http://x.test/v1" })).toBe(
      "Il server del modello non risponde: è avviato? (http://x.test/v1)",
    );
  });

  it("unknown error: falls back to its message", () => {
    expect(describeLlmError(new Error("qualcosa di strano"))).toBe("qualcosa di strano");
  });

  it("non-Error value: falls back to the generic message", () => {
    expect(describeLlmError({ weird: true })).toBe("Errore inatteso.");
  });
});
