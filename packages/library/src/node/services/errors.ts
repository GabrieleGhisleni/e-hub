/**
 * Errors of the services layer. Each carries a stable `code` (see `ApiErrorCode` in src/shared/api.ts) and the HTTP
 * status the server answers with; messages are Italian because the admin UI shows them as they are.
 */
import type { ApiErrorCode, ReconcileReport } from "../../shared/api.ts";

export class ServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}

/** The operation stopped because Drive could not be aligned; the repo is unchanged. `details.report` says why. */
export class DriveFailedError extends ServiceError {
  readonly report: ReconcileReport;

  constructor(message: string, report: ReconcileReport) {
    super("drive-failed", 502, message, { details: { report } });
    this.name = "DriveFailedError";
    this.report = report;
  }
}

export function badRequest(code: ApiErrorCode, message: string, details?: unknown): ServiceError {
  return new ServiceError(code, 400, message, details === undefined ? {} : { details });
}

export function notFound(code: ApiErrorCode, message: string): ServiceError {
  return new ServiceError(code, 404, message);
}

export function conflict(code: ApiErrorCode, message: string, details?: unknown): ServiceError {
  return new ServiceError(code, 409, message, details === undefined ? {} : { details });
}

export function tooLarge(message: string): ServiceError {
  return new ServiceError("payload-too-large", 413, message);
}

/** First lines of every report error, for messages. */
export function reportErrorSummary(report: ReconcileReport, max = 3): string {
  const lines = report.errors.slice(0, max).map((e) => e.message);
  const more = report.errors.length - lines.length;
  return more > 0 ? `${lines.join("; ")} (+${more})` : lines.join("; ");
}
