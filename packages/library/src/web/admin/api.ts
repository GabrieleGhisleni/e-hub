/**
 * Typed client of the local API (src/shared/api.ts). Responses are parsed with the shared Zod schemas; failures
 * become `ApiRequestError` (see lib/errors.ts for the Italian messages). Writes call `refreshSiteData()` so the
 * public pages show the new data right away.
 */
import { z } from "zod";
import {
  ApiErrorSchema,
  BookWriteResponseSchema,
  BulkUpdateResponseSchema,
  CoverCandidatesResponseSchema,
  DeleteBookResponseSchema,
  DeleteTopicResponseSchema,
  SaveNotesResponseSchema,
  SummarizeResponseSchema,
  TopicWriteResponseSchema,
  TopicsResponseSchema,
  UploadResponseSchema,
  apiPaths,
  emptyReconcileReport,
  mergeReconcileReports,
  type BookPatch,
  type BookWriteResponse,
  type BulkUpdateRequest,
  type BulkUpdateResponse,
  type CandidateSource,
  type CoverCandidatesResponse,
  type CreateBookRequest,
  type DeleteBookResponse,
  type DeleteTopicResponse,
  type SetCoverRequest,
  type SaveNotesResponse,
  type SummarizeRequest,
  type SummarizeResponse,
  type TopicWriteResponse,
  type TopicsResponse,
  type UploadResponse,
} from "@shared/api";
import {
  ZlibrarySearchResponseSchema,
  ZlibraryStatusResponseSchema,
  zlibraryPaths,
  type ZlibrarySearchRequest,
  type ZlibrarySearchResponse,
  type ZlibraryStatusResponse,
} from "@shared/zlibrary";
import {
  SettingsResponseSchema,
  healthPaths,
  ServicesHealthResponseSchema,
  type ServicesHealthResponse,
  settingsPaths,
  type SettingsResponse,
  type SettingsUpdate,
} from "@shared/settings";
import { refreshSiteData } from "@library/data/site-data";
import { ApiRequestError, isServerDownStatus } from "./lib/errors";

async function request<S extends z.ZodType>(
  method: string,
  url: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const response = await send(method, url, body, signal);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiRequestError({
      status: response.status,
      code: "bad-response",
      message: "Risposta del server non valida.",
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError({
      status: response.status,
      code: "bad-response",
      message: "Il server ha risposto in un formato inatteso.",
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

async function send(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const init: RequestInit = { method, signal, headers: { Accept: "application/json" } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiRequestError({
      status: 0,
      code: "network",
      message: cause instanceof Error ? cause.message : "Errore di rete",
    });
  }
  if (response.ok) return response;
  throw await toApiError(response);
}

async function toApiError(response: Response): Promise<ApiRequestError> {
  try {
    const parsed = ApiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiRequestError({ status: response.status, code, message, details });
    }
  } catch {
    // Not JSON (e.g. the Vite proxy answered 500/502/504 because the server is down).
  }
  const down = isServerDownStatus(response.status);
  return new ApiRequestError({
    status: response.status,
    code: down ? "network" : "internal-error",
    message: `Errore del server (HTTP ${response.status}).`,
  });
}

/** After a successful write: the site data changed on disk, refetch it (idempotent with the dev HMR event). */
async function written<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  void refreshSiteData();
  return result;
}

export const adminApi = {
  uploadEpub(file: File, signal?: AbortSignal): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file, file.name);
    return request("POST", apiPaths.uploads, UploadResponseSchema, form, signal);
  },

  async discardUpload(uploadId: string): Promise<void> {
    await send("DELETE", apiPaths.upload(uploadId));
  },

  createBook(body: CreateBookRequest): Promise<BookWriteResponse> {
    return written(request("POST", apiPaths.books, BookWriteResponseSchema, body));
  },

  updateBook(id: string, patch: BookPatch): Promise<BookWriteResponse> {
    return written(request("PATCH", apiPaths.book(id), BookWriteResponseSchema, patch));
  },

  deleteBook(id: string): Promise<DeleteBookResponse> {
    return written(request("DELETE", apiPaths.book(id), DeleteBookResponseSchema));
  },

  async bulkDelete(ids: readonly string[]) {
    const report = emptyReconcileReport();
    const deletedIds: string[] = [];
    const failures = new Map<string, unknown>();

    // Keep the per-book delete semantics and order, and reload the index once for the batch.
    for (const id of ids) {
      try {
        const response = await request("DELETE", apiPaths.book(id), DeleteBookResponseSchema);
        deletedIds.push(id);
        mergeReconcileReports(report, response.report);
      } catch (error) {
        failures.set(id, error);
      }
    }
    void refreshSiteData();
    return { deletedIds, failures, report };
  },

  coverCandidates(id: string, signal?: AbortSignal): Promise<CoverCandidatesResponse> {
    return request(
      "GET",
      apiPaths.bookCoverCandidates(id),
      CoverCandidatesResponseSchema,
      undefined,
      signal,
    );
  },

  setCover(id: string, body: SetCoverRequest): Promise<BookWriteResponse> {
    return written(request("PUT", apiPaths.bookCover(id), BookWriteResponseSchema, body));
  },

  uploadCoverImage(id: string, image: File): Promise<BookWriteResponse> {
    const form = new FormData();
    form.append("image", image, image.name);
    return written(request("PUT", apiPaths.bookCover(id), BookWriteResponseSchema, form));
  },

  bulkUpdate(body: BulkUpdateRequest): Promise<BulkUpdateResponse> {
    return written(request("POST", apiPaths.bulk, BulkUpdateResponseSchema, body));
  },

  listTopics(signal?: AbortSignal): Promise<TopicsResponse> {
    return request("GET", apiPaths.topics, TopicsResponseSchema, undefined, signal);
  },

  addTopic(label: string): Promise<TopicWriteResponse> {
    return written(request("POST", apiPaths.topics, TopicWriteResponseSchema, { label }));
  },

  renameTopic(id: string, label: string): Promise<TopicWriteResponse> {
    return written(request("PATCH", apiPaths.topic(id), TopicWriteResponseSchema, { label }));
  },

  deleteTopic(id: string): Promise<DeleteTopicResponse> {
    return written(request("DELETE", apiPaths.topic(id), DeleteTopicResponseSchema));
  },

  /** Slow: one model call per chapter. No client timeout; the dialog shows a spinner meanwhile. */
  summarizeBook(id: string, body: SummarizeRequest): Promise<SummarizeResponse> {
    return written(request("POST", apiPaths.bookSummary(id), SummarizeResponseSchema, body));
  },

  saveNotes(id: string, notes: string): Promise<SaveNotesResponse> {
    return written(request("PUT", apiPaths.bookNotes(id), SaveNotesResponseSchema, { notes }));
  },

  settings(): Promise<SettingsResponse> {
    return request("GET", settingsPaths.keys, SettingsResponseSchema);
  },

  saveSettings(update: SettingsUpdate): Promise<SettingsResponse> {
    return request("PUT", settingsPaths.keys, SettingsResponseSchema, update);
  },

  servicesHealth(): Promise<ServicesHealthResponse> {
    return request("GET", healthPaths.services, ServicesHealthResponseSchema);
  },

  zlibraryStatus(): Promise<ZlibraryStatusResponse> {
    return request("GET", zlibraryPaths.status, ZlibraryStatusResponseSchema);
  },

  /** Signs in to Z-Library once with the user's own account; the server keeps only the session key. */
  zlibraryConnect(email: string, password: string): Promise<ZlibraryStatusResponse> {
    return request("POST", zlibraryPaths.session, ZlibraryStatusResponseSchema, { email, password });
  },

  async zlibraryDisconnect(): Promise<void> {
    await send("DELETE", zlibraryPaths.session);
  },

  zlibrarySearch(
    req: ZlibrarySearchRequest,
    signal?: AbortSignal,
  ): Promise<ZlibrarySearchResponse> {
    return request("POST", zlibraryPaths.search, ZlibrarySearchResponseSchema, req, signal);
  },

  /** The book staged like an upload: pass the result to the "Aggiungi libro" form. */
  zlibraryStage(id: string, hash: string, pages?: number | null): Promise<UploadResponse> {
    return request("POST", zlibraryPaths.stage(id, hash, pages), UploadResponseSchema);
  },

  /** The original EPUB, as downloaded from Z-Library; the file name comes from Content-Disposition. */
  async zlibraryEpub(id: string, hash: string): Promise<{ blob: Blob; fileName: string }> {
    const response = await send("POST", zlibraryPaths.epub(id, hash));
    const blob = await response.blob();
    return { blob, fileName: fileNameFromDisposition(response.headers.get("Content-Disposition")) };
  },
};

const FALLBACK_EPUB_NAME = "libro.epub";

/** `attachment; filename*=UTF-8''...` (preferred) or `attachment; filename="..."`. */
function fileNameFromDisposition(header: string | null): string {
  if (!header) return FALLBACK_EPUB_NAME;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      const name = decodeURIComponent(encoded.trim());
      if (name) return name;
    } catch {
      // Malformed percent-encoding: try the plain form below.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] || FALLBACK_EPUB_NAME;
}

/** URL of a candidate cover image of a staged upload / an existing book (the server answers `Cache-Control: no-store`). */
export function uploadCoverUrl(uploadId: string, source: CandidateSource): string {
  return apiPaths.uploadCover(uploadId, source);
}
export function bookCoverCandidateUrl(id: string, source: CandidateSource): string {
  return apiPaths.bookCoverCandidate(id, source);
}
