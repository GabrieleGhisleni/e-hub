/**
 * Error types shared by core, CLI and server. Isomorphic (no Node imports).
 * Each error has a stable `code`; `exitCodeFor` / `httpStatusFor` map them for
 * the CLI and the local server.
 */

export type CoreErrorCode =
  | "validation"
  | "not-found"
  | "conflict"
  | "transcript-guard"
  | "duplicate"
  | "already-exists";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  /** One line per problem, already human-readable (e.g. `tags[1]: tag must be lowercase…`). */
  readonly details: string[];

  constructor(code: CoreErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }

  /** Message plus details, one per line. */
  describe(): string {
    return [this.message, ...this.details.map((detail) => `  - ${detail}`)].join("\n");
  }
}

/** Invalid input or invalid data on disk. */
export class ValidationError extends CoreError {
  constructor(message: string, details: string[] = []) {
    super("validation", message, details);
  }
}

export class NotFoundError extends CoreError {
  constructor(message: string) {
    super("not-found", message);
  }
}

/** `expectedUpdatedAt` differs from the file's `updatedAt`: someone else wrote in the meantime. */
export class ConflictError extends CoreError {
  readonly expectedUpdatedAt: string;
  readonly actualUpdatedAt: string;

  constructor(slug: string, expectedUpdatedAt: string, actualUpdatedAt: string) {
    super(
      "conflict",
      `episode '${slug}' was modified in the meantime (expected updatedAt ${expectedUpdatedAt}, found ${actualUpdatedAt}); reload and retry`,
    );
    this.expectedUpdatedAt = expectedUpdatedAt;
    this.actualUpdatedAt = actualUpdatedAt;
  }
}

/** Save rejected by the transcript guard (DESIGN.md §5.1): excerpt in summary/notes, or oversized conversation without a local transcript. */
export class TranscriptGuardError extends CoreError {
  constructor(message: string, details: string[]) {
    super("transcript-guard", message, details);
  }
}

/** An episode with the same URL or YouTube id already exists (DESIGN.md §13). */
export class DuplicateEpisodeError extends CoreError {
  readonly existingSlug: string;

  constructor(existingSlug: string, reason: string) {
    super("duplicate", `episode already exists: '${existingSlug}' (${reason})`);
    this.existingSlug = existingSlug;
  }
}

/** Creating an entity whose file already exists. */
export class AlreadyExistsError extends CoreError {
  constructor(message: string) {
    super("already-exists", message);
  }
}

/**
 * CLI exit codes. 0 = ok; 1 = unexpected error; 2 = bad command-line usage.
 * Core errors get their own code so scripts and agents can tell them apart.
 */
export const EXIT_CODES = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  validation: 3,
  "not-found": 4,
  conflict: 5,
  "transcript-guard": 6,
  duplicate: 7,
  "already-exists": 8,
} as const satisfies Record<CoreErrorCode | "ok" | "unexpected" | "usage", number>;

export function exitCodeFor(error: unknown): number {
  return error instanceof CoreError ? EXIT_CODES[error.code] : EXIT_CODES.unexpected;
}

const HTTP_STATUS: Record<CoreErrorCode, number> = {
  validation: 400,
  "not-found": 404,
  conflict: 409,
  "transcript-guard": 422,
  duplicate: 409,
  "already-exists": 409,
};

/** HTTP status for the local server (phase 7). Non-core errors → 500. */
export function httpStatusFor(error: unknown): number {
  return error instanceof CoreError ? HTTP_STATUS[error.code] : 500;
}
