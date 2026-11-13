/**
 * HTTP helpers shared by the route modules: the error envelope (`ApiError`) and the validated JSON body.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { type ApiError, type ApiErrorCode } from "../../shared/api.ts";
import { ServiceError } from "../services/index.ts";

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return c.json(body, status);
}

/** JSON body validated with `schema`: 415 when not JSON, 400 `invalid-request` (Zod issues in details) otherwise. */
export async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new ServiceError("unsupported-media-type", 415, "Serve un corpo application/json.");
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new ServiceError("invalid-request", 400, "JSON non valido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError(
      "invalid-request",
      400,
      `Richiesta non valida: ${z.prettifyError(parsed.error)}`,
      { details: { issues: parsed.error.issues } },
    );
  }
  return parsed.data;
}
