/** Maps thrown errors to JSON responses `{error, code, ...}`; never leaks stack traces. */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { ConflictError, CoreError, httpStatusFor } from "../core/errors";
import { formatIssues } from "../core/schema";
import { FeedDecisionRequiredError, HttpError } from "../core/ingest";

/** The request itself is malformed (bad JSON, wrong shape). */
export class BadRequestError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.details = details;
  }
}

export interface ErrorBody {
  error: string;
  code: string;
  details?: string[];
  [key: string]: unknown;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "la fonte";
  }
}

export function toErrorResponse(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof BadRequestError) {
    return {
      status: 400,
      body: { error: error.message, code: "bad-request", details: error.details },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { error: "Richiesta non valida.", code: "bad-request", details: formatIssues(error) },
    };
  }
  if (error instanceof HttpError) {
    return {
      status: 502,
      body: {
        error: `Errore di rete verso ${hostOf(error.url)}: riprova più tardi.`,
        code: "network",
        details: [error.message],
      },
    };
  }
  if (error instanceof CoreError) {
    // Validation and guard rejections are 422 (the request was understood, the content refused).
    const status = (
      error.code === "validation" ? 422 : httpStatusFor(error)
    ) as ContentfulStatusCode;
    const body: ErrorBody = { error: error.message, code: error.code, details: error.details };
    if (error instanceof ConflictError) {
      body.expectedUpdatedAt = error.expectedUpdatedAt;
      body.actualUpdatedAt = error.actualUpdatedAt;
    }
    if (error instanceof FeedDecisionRequiredError) {
      body.code = "feed-decision-required";
      body.candidates = error.candidates;
    }
    return { status, body };
  }
  console.error("[api] unexpected error:", error instanceof Error ? error.message : error);
  return { status: 500, body: { error: "Errore interno del server.", code: "internal" } };
}

export function handleError(error: unknown, c: Context): Response {
  const { status, body } = toErrorResponse(error);
  return c.json(body, status);
}
