/**
 * Local API contract (W3a; consumed by the admin UI, W4a). Everything lives under `/api/library` on the local Hono server
 * (127.0.0.1 only), proxied by Vite in dev, so the UI calls it same-origin with relative URLs (`apiPaths`).
 *
 * Conventions
 * - JSON in, JSON out (`application/json`), except the multipart uploads and the cover images (`image/webp`).
 * - Errors: HTTP 4xx/5xx with an `ApiError` body `{error: {code, message, details?}}`. `message` is Italian and can be
 *   shown as is; `code` is stable (see `ApiErrorCode`). Request validation errors carry the Zod issues in `details`.
 * - Every write response carries a `ReconcileReport` (what was done on Drive, warnings, errors).
 *   Rule: when the repo change was made the status is 2xx even if Drive could not be aligned (the report has errors:
 *   `elib sync` finishes the job later). When the operation was aborted and the repo is unchanged (create/delete whose
 *   Drive step failed) the status is 502 with code `drive-failed` and `details: {report}`.
 * - Security: requests must come from the local UI (Host / Origin / Sec-Fetch-Site checks, see the server). Every
 *   non-GET request needs an `Origin` header from `server.allowedOrigins`: browsers add it; with curl pass
 *   `-H 'Origin: http://127.0.0.1:5173'`.
 */
import { z } from "zod";
import {
  BookIdSchema,
  BookSchema,
  BookStatusSchema,
  IsoDateSchema,
  NonBlankStringSchema,
  TopicIdSchema,
  TopicSchema,
} from "./schema.ts";

// ---------------------------------------------------------------------------------------------
// Paths and limits
// ---------------------------------------------------------------------------------------------

/** Relative URLs of every endpoint (same origin through the Vite proxy). */
export const apiPaths = {
  health: "/api/library/health",
  /** POST multipart `file` → `UploadResponse`. */
  uploads: "/api/library/uploads",
  /** DELETE → 204: discards a staged upload (form cancelled). */
  upload: (uploadId: string) => `/api/library/uploads/${encodeURIComponent(uploadId)}`,
  /** GET → `image/webp` candidate cover of a staged upload. */
  uploadCover: (uploadId: string, source: CandidateSource) =>
    `/api/library/uploads/${encodeURIComponent(uploadId)}/covers/${source}`,
  /** POST `CreateBookRequest` → 201 `BookWriteResponse`. */
  books: "/api/library/books",
  /** PATCH `BookPatch` → `BookWriteResponse`; DELETE → `DeleteBookResponse`. */
  book: (id: string) => `/api/library/books/${encodeURIComponent(id)}`,
  /** GET → `CoverCandidatesResponse` (may take a few seconds: Drive download, Open Library). */
  bookCoverCandidates: (id: string) => `/api/library/books/${encodeURIComponent(id)}/cover-candidates`,
  /** GET → `image/webp` candidate cover of an existing book. */
  bookCoverCandidate: (id: string, source: CandidateSource) =>
    `/api/library/books/${encodeURIComponent(id)}/cover-candidates/${source}`,
  /** PUT `SetCoverRequest` (JSON) or multipart `image` → `BookWriteResponse`. */
  bookCover: (id: string) => `/api/library/books/${encodeURIComponent(id)}/cover`,
  /** POST `BulkUpdateRequest` → `BulkUpdateResponse`. */
  bulk: "/api/library/books/bulk",
  /** GET → `TopicsResponse`; POST `TopicLabelRequest` → 201 `TopicWriteResponse`. */
  topics: "/api/library/topics",
  /** PATCH `TopicLabelRequest` → `TopicWriteResponse`; DELETE → `DeleteTopicResponse`. */
  topic: (id: string) => `/api/library/topics/${encodeURIComponent(id)}`,
} as const;

/** Request size limits enforced by the server (HTTP 413 `payload-too-large` beyond them). */
export const API_LIMITS = {
  /** Uploaded EPUB. */
  epubMaxBytes: 200 * 1024 * 1024,
  /** Uploaded cover image (multipart `image`). */
  imageMaxBytes: 20 * 1024 * 1024,
  /** JSON bodies. */
  jsonMaxBytes: 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * Stable error codes:
 * - 400 `invalid-request` (body/params fail validation; Zod issues in `details`), `not-an-epub`, `kepub-not-supported`,
 *   `invalid-image`, `unknown-topic`, `cover-unavailable`, `topic-protected` (`unsorted` cannot be deleted);
 * - 403 `forbidden-host`, `forbidden-origin`, `origin-required`, `forbidden-fetch-site` (security checks);
 * - 404 `not-found`, `book-not-found`, `upload-not-found` (unknown or expired: staging lasts 24h), `topic-not-found`;
 * - 409 `topic-conflict` (label maps to the folder of another topic), `invalid-book` (book.json on disk is invalid),
 *   `cover-changed` (the Open Library candidate is not the one the client saw);
 * - 413 `payload-too-large`; 415 `unsupported-media-type`;
 * - 409 `busy` (another elib process, e.g. the CLI or the server, holds the write lock);
 * - 502 `drive-failed` (`details: {report}`), `kepub-failed`;
 * - 500 `internal-error`.
 */
export type ApiErrorCode =
  | "invalid-request"
  | "not-an-epub"
  | "kepub-not-supported"
  | "invalid-image"
  | "unknown-topic"
  | "cover-unavailable"
  | "topic-protected"
  | "forbidden-host"
  | "forbidden-origin"
  | "origin-required"
  | "forbidden-fetch-site"
  | "not-found"
  | "book-not-found"
  | "upload-not-found"
  | "topic-not-found"
  | "topic-conflict"
  | "invalid-book"
  | "cover-changed"
  | "payload-too-large"
  | "unsupported-media-type"
  | "drive-failed"
  | "kepub-failed"
  | "busy"
  | "internal-error";

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------------------------
// Reconcile report (also printed by `elib sync`)
// ---------------------------------------------------------------------------------------------

export const ReconcileActionTypeSchema = z.enum([
  /** Copy a file from the local cache to its expected Drive path. */
  "upload",
  /** Move a misplaced file (recognized by the ID in its name) to its expected path. */
  "move",
  /** Send a file to the Drive trash (delete, or `sync --prune` on orphans). */
  "trash",
  /** Remove a now-empty topic folder (after moves or a topic rename). */
  "rmdir",
]);
export type ReconcileActionType = z.infer<typeof ReconcileActionTypeSchema>;

export const ReconcileActionSchema = z.object({
  type: ReconcileActionTypeSchema,
  /** `planned` in dry runs (or before execution), `done` once rclone succeeded, `failed` otherwise (see errors). */
  status: z.enum(["planned", "done", "failed"]),
  bookId: BookIdSchema.optional(),
  tree: z.enum(["kobo", "archive"]).optional(),
  /** Source: a remote path, or a local cache path for uploads. */
  from: z.string().optional(),
  /** Destination remote path (relative to the remote root). */
  to: z.string().optional(),
});
export type ReconcileAction = z.infer<typeof ReconcileActionSchema>;

export const ReconcileMessageSchema = z.object({
  /** Stable machine code, e.g. `orphan-file`, `missing-in-cache`, `duplicate-id`, `rclone-failed`. */
  code: z.string(),
  message: z.string(),
  bookId: BookIdSchema.optional(),
  path: z.string().optional(),
});
export type ReconcileMessage = z.infer<typeof ReconcileMessageSchema>;

export const ReconcileReportSchema = z.object({
  dryRun: z.boolean(),
  actions: z.array(ReconcileActionSchema),
  warnings: z.array(ReconcileMessageSchema),
  errors: z.array(ReconcileMessageSchema),
});
export type ReconcileReport = z.infer<typeof ReconcileReportSchema>;

export function emptyReconcileReport(dryRun = false): ReconcileReport {
  return { dryRun, actions: [], warnings: [], errors: [] };
}

/** Appends `extra` to `into` (actions, warnings, errors); returns `into`. */
export function mergeReconcileReports(
  into: ReconcileReport,
  ...extra: ReconcileReport[]
): ReconcileReport {
  for (const r of extra) {
    into.actions.push(...r.actions);
    into.warnings.push(...r.warnings);
    into.errors.push(...r.errors);
  }
  return into;
}

// ---------------------------------------------------------------------------------------------
// Health: GET /api/library/health
// ---------------------------------------------------------------------------------------------

export const HealthResponseSchema = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Uploads: POST /api/library/uploads (multipart `file`), GET /api/library/uploads/:uploadId/covers/:source,
// DELETE /api/library/uploads/:uploadId
// ---------------------------------------------------------------------------------------------

/** Where a book's cover comes from when it is created or changed. */
export const CoverSourceSchema = z.enum(["epub", "openlibrary", "placeholder"]);
export type CoverSource = z.infer<typeof CoverSourceSchema>;

/** Sources that have a candidate image to preview (the placeholder is generated from title + author). */
export const CandidateSourceSchema = z.enum(["epub", "openlibrary"]);
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

/** Metadata extracted from the EPUB, before my corrections. Every field may be missing. */
export const ExtractedMetadataSchema = z.object({
  title: z.string().optional(),
  authors: z.array(z.string()),
  subjects: z.array(z.string()),
  /** ISBN-13 digits. */
  isbn: z.string().optional(),
  language: z.string().optional(),
  publisher: z.string().optional(),
  description: z.string().optional(),
});
export type ExtractedMetadata = z.infer<typeof ExtractedMetadataSchema>;

export const CoverCandidateSchema = z.object({
  source: CandidateSourceSchema,
  /** URL of the candidate image (`image/webp`, already normalized to the final cover) on the local API. */
  url: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Open Library only. */
  openLibraryCoverId: z.number().int().positive().optional(),
  /** Open Library only: how the match was found. */
  matchedBy: z.enum(["isbn", "title-author"]).optional(),
  /** Open Library only: title / authors of the matched record (to judge a title+author match). */
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  /** True for title+author matches: often another edition, must be confirmed by hand (PLAN §8). */
  needsConfirmation: z.boolean(),
});
export type CoverCandidate = z.infer<typeof CoverCandidateSchema>;

export const DuplicateMatchSchema = z.discriminatedUnion("kind", [
  /** Same MD5 as a file already in the Archivio tree (`rclone md5sum`). */
  z.object({ kind: z.literal("md5"), path: z.string(), bookId: BookIdSchema.nullable() }),
  /** Same title and an author in common with a book in the repo (case/accent-insensitive; warning only). */
  z.object({
    kind: z.literal("title-author"),
    bookId: BookIdSchema,
    title: z.string(),
    authors: z.array(z.string()),
  }),
]);
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

export const UploadResponseSchema = z.object({
  /** Pass it to `POST /api/library/books`. The staging area is discarded after 24h. */
  uploadId: z.string(),
  /** Original file name as uploaded. */
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  metadata: ExtractedMetadataSchema,
  /** EPUB cover first, then Open Library; empty when neither exists (use the placeholder). */
  covers: z.array(CoverCandidateSchema),
  duplicates: z.array(DuplicateMatchSchema),
  /** Extraction warnings, Open Library failures, duplicate check failures (Italian or English, informative). */
  warnings: z.array(z.string()),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------------------------

/** A new book as sent by the form: everything but the ID, which the server generates. */
export const NewBookSchema = BookSchema.omit({ id: true });
export type NewBook = z.infer<typeof NewBookSchema>;

/** POST /api/library/books */
export const CreateBookRequestSchema = z.object({
  uploadId: z.string(),
  book: NewBookSchema,
  cover: CoverSourceSchema,
  /**
   * Optional check with `cover: "openlibrary"`: the cover ID the client showed. 409 `cover-changed` if it differs from
   * the staged candidate. The server stores the staged candidate's ID as `openLibraryCoverId` either way (and `isbn`
   * when the match came from the ISBN and the book has none).
   */
  openLibraryCoverId: z.number().int().positive().optional(),
});
export type CreateBookRequest = z.infer<typeof CreateBookRequestSchema>;

/** Response of every single-book write (create, patch, cover change). */
export const BookWriteResponseSchema = z.object({
  book: BookSchema,
  report: ReconcileReportSchema,
});
export type BookWriteResponse = z.infer<typeof BookWriteResponseSchema>;

/**
 * PATCH /api/library/books/:id — only the fields to change. `null` removes an optional field.
 * Required fields cannot be null; `id` cannot be changed; unknown fields already in book.json are preserved.
 */
export const BookPatchSchema = z.strictObject({
  title: NonBlankStringSchema.optional(),
  authors: z.array(NonBlankStringSchema).min(1).optional(),
  topic: TopicIdSchema.optional(),
  status: BookStatusSchema.optional(),
  tags: z.array(NonBlankStringSchema).nullable().optional(),
  startedAt: IsoDateSchema.nullable().optional(),
  finishedAt: IsoDateSchema.nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  isbn: z.string().nullable().optional(),
  openLibraryCoverId: z.number().int().positive().nullable().optional(),
  publisher: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  subjects: z.array(z.string()).nullable().optional(),
});
export type BookPatch = z.infer<typeof BookPatchSchema>;

/** GET /api/library/books/:id/cover-candidates (EPUB cover from the cached EPUB, downloaded from Drive when missing). */
export const CoverCandidatesResponseSchema = z.object({
  candidates: z.array(CoverCandidateSchema),
  /** Why a candidate is missing (no cached EPUB, Open Library down…). */
  warnings: z.array(z.string()),
});
export type CoverCandidatesResponse = z.infer<typeof CoverCandidatesResponseSchema>;

/**
 * PUT /api/library/books/:id/cover, JSON form (a multipart `image` upload is the other form). `epub` / `openlibrary` use the
 * candidates prepared by `GET …/cover-candidates` (computed on the fly when missing); `placeholder` is generated.
 */
export const SetCoverRequestSchema = z.object({
  source: CoverSourceSchema,
  /** Optional check with `source: "openlibrary"` (409 `cover-changed` when it differs). */
  openLibraryCoverId: z.number().int().positive().optional(),
});
export type SetCoverRequest = z.infer<typeof SetCoverRequestSchema>;

/** POST /api/library/books/bulk */
export const BulkUpdateRequestSchema = z.object({
  ids: z.array(BookIdSchema).min(1),
  patch: z
    .strictObject({
      topic: TopicIdSchema.optional(),
      status: BookStatusSchema.optional(),
      addTags: z.array(NonBlankStringSchema).optional(),
      removeTags: z.array(NonBlankStringSchema).optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), "patch must change something"),
});
export type BulkUpdateRequest = z.infer<typeof BulkUpdateRequestSchema>;
export type BulkPatch = BulkUpdateRequest["patch"];

export const BulkUpdateResponseSchema = z.object({
  books: z.array(BookSchema),
  report: ReconcileReportSchema,
});
export type BulkUpdateResponse = z.infer<typeof BulkUpdateResponseSchema>;

/** DELETE /api/library/books/:id — Drive files to the trash, then the repo folder is removed (cache kept). */
export const DeleteBookResponseSchema = z.object({
  id: BookIdSchema,
  report: ReconcileReportSchema,
});
export type DeleteBookResponse = z.infer<typeof DeleteBookResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------------------------

/** A topic with the number of books that use it (repo books with a valid book.json). */
export const TopicUsageSchema = TopicSchema.extend({
  bookCount: z.number().int().nonnegative(),
});
export type TopicUsage = z.infer<typeof TopicUsageSchema>;

/** GET /api/library/topics — in topics.json order; `bookCount` lets the UI say "N libri verranno spostati in Da smistare". */
export const TopicsResponseSchema = z.object({ topics: z.array(TopicUsageSchema) });
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;

/** POST /api/library/topics, PATCH /api/library/topics/:id */
export const TopicLabelRequestSchema = z.object({ label: NonBlankStringSchema });
export type TopicLabelRequest = z.infer<typeof TopicLabelRequestSchema>;

export const TopicWriteResponseSchema = z.object({
  topic: TopicSchema,
  topics: z.array(TopicSchema),
  report: ReconcileReportSchema,
});
export type TopicWriteResponse = z.infer<typeof TopicWriteResponseSchema>;

/** DELETE /api/library/topics/:id — books are reassigned to `unsorted`; `reassigned` is how many. */
export const DeleteTopicResponseSchema = z.object({
  id: TopicIdSchema,
  reassigned: z.number().int().nonnegative(),
  topics: z.array(TopicSchema),
  report: ReconcileReportSchema,
});
export type DeleteTopicResponse = z.infer<typeof DeleteTopicResponseSchema>;
