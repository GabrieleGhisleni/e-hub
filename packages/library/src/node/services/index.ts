/**
 * Services layer (W3a): the one implementation of every admin operation (PLAN §7), shared by the Hono server and the
 * `elib` CLI. Every function takes a `ServiceContext`; `createServices(ctx)` binds them for the server.
 */
import { type DrainResult, createKoboContext, drainKoboQueue, koboAllowed, koboResolver, listQueue } from "../kobo/index.ts";
import type {
  BookPatch,
  BookWriteResponse,
  BulkUpdateRequest,
  BulkUpdateResponse,
  CoverCandidatesResponse,
  CreateBookRequest,
  DeleteBookResponse,
  DeleteTopicResponse,
  SaveNotesRequest,
  SaveNotesResponse,
  SummarizeRequest,
  SummarizeResponse,
  TopicWriteResponse,
  TopicsResponse,
  UploadResponse,
} from "../../shared/api.ts";
import { bulkUpdate, createBook, deleteBook, updateBook } from "./books.ts";
import type { ServiceContext } from "./context.ts";
import {
  type SetCoverInput,
  coverCandidates,
  readBookCoverCandidate,
  setBookCover,
} from "./covers.ts";
import { saveBookNotes } from "./notes.ts";
import { type SummarizeServiceOptions, summarizeBookService } from "./summary.ts";
import { addTopic, deleteTopic, listTopics, renameTopic } from "./topics.ts";
import {
  type AnalyzeUploadOptions,
  type UploadInput,
  analyzeUpload,
  cleanupStaleUploads,
  discardUpload,
  readUploadCover,
} from "./uploads.ts";

export {
  type Logger,
  type ServiceContext,
  type ServiceContextOptions,
  type ServiceLimits,
  consoleLogger,
  createServiceContext,
  silentLogger,
} from "./context.ts";
export { KoboFailedError, ServiceError } from "./errors.ts";
export { LOCK_FILE_NAME, LockBusyError, Mutex, ProcessLock } from "./mutex.ts";
export {
  applyBookPatch,
  applyBulkPatch,
  bulkUpdate,
  createBook,
  deleteBook,
  updateBook,
} from "./books.ts";
export {
  type SetCoverInput,
  coverCandidates,
  readBookCoverCandidate,
  setBookCover,
} from "./covers.ts";
export {
  type ImportDuplicate,
  type ImportItem,
  type ImportOptions,
  type ImportResult,
  type ImportScan,
  UNKNOWN_AUTHOR,
  importFolder,
  scanImportFolder,
} from "./import.ts";
export {
  type SummarizeServiceOptions,
  startSummaryInBackground,
  summarizeBookService,
} from "./summary.ts";
export { saveBookNotes } from "./notes.ts";
export { promoteExploreBook } from "./explore-promote.ts";
export { addTopic, deleteTopic, listTopics, renameTopic } from "./topics.ts";
export {
  type AnalyzeUploadOptions,
  type StagedAnalysis,
  type UploadInput,
  analyzeUpload,
  cleanupStaleUploads,
  discardUpload,
  readUploadCover,
} from "./uploads.ts";

/** The services bound to one context (what the server needs). */
export interface KoboQueueResponse {
  pending: string[];
}

/** Drain the queue; when the configured Kobo host does not answer, look for the Kobo on the LAN (kobo/discovery.ts). */
export function drainWithDiscovery(ctx: ServiceContext): Promise<DrainResult> {
  const makeContext = (host: string) =>
    createKoboContext(
      { ...ctx.config, kobo: { ...ctx.config.kobo, host } },
      { queue: true },
    );
  return drainKoboQueue(ctx.kobo, koboResolver({ makeContext }));
}

export interface Services {
  readonly ctx: ServiceContext;
  analyzeUpload(input: UploadInput, options?: AnalyzeUploadOptions): Promise<UploadResponse>;
  readUploadCover(uploadId: string, source: string): Promise<Uint8Array>;
  discardUpload(uploadId: string): Promise<void>;
  cleanupStaleUploads(): Promise<number>;
  createBook(request: CreateBookRequest): Promise<BookWriteResponse>;
  updateBook(id: string, patch: BookPatch): Promise<BookWriteResponse>;
  bulkUpdate(request: BulkUpdateRequest): Promise<BulkUpdateResponse>;
  deleteBook(id: string): Promise<DeleteBookResponse>;
  coverCandidates(id: string): Promise<CoverCandidatesResponse>;
  readBookCoverCandidate(id: string, source: string): Promise<Uint8Array>;
  setBookCover(id: string, input: SetCoverInput): Promise<BookWriteResponse>;
  listTopics(): Promise<TopicsResponse>;
  addTopic(label: string): Promise<TopicWriteResponse>;
  renameTopic(id: string, label: string): Promise<TopicWriteResponse>;
  deleteTopic(id: string): Promise<DeleteTopicResponse>;
  saveBookNotes(id: string, request: SaveNotesRequest): Promise<SaveNotesResponse>;
  /** Books waiting for the Kobo (hosted setup). */
  koboQueue(): Promise<KoboQueueResponse>;
  /** Drains the queue now if the Kobo answers (the "sincronizza ora" button). */
  syncKoboNow(): Promise<DrainResult>;
  summarizeBook(
    id: string,
    request: SummarizeRequest,
    options?: SummarizeServiceOptions,
  ): Promise<SummarizeResponse>;
}

export function createServices(ctx: ServiceContext): Services {
  return {
    ctx,
    koboQueue: async () => ({
      pending: koboAllowed() ? (await listQueue(ctx.dataDir)).map((e) => e.bookId) : [],
    }),
    syncKoboNow: () => ctx.lock.runExclusive(() => drainWithDiscovery(ctx)),
    analyzeUpload: (input, options) => analyzeUpload(ctx, input, options),
    readUploadCover: (uploadId, source) => readUploadCover(ctx, uploadId, source),
    discardUpload: (uploadId) => discardUpload(ctx, uploadId),
    cleanupStaleUploads: () => cleanupStaleUploads(ctx),
    createBook: (request) => createBook(ctx, request),
    updateBook: (id, patch) => updateBook(ctx, id, patch),
    bulkUpdate: (request) => bulkUpdate(ctx, request),
    deleteBook: (id) => deleteBook(ctx, id),
    coverCandidates: (id) => coverCandidates(ctx, id),
    readBookCoverCandidate: (id, source) => readBookCoverCandidate(ctx, id, source),
    setBookCover: (id, input) => setBookCover(ctx, id, input),
    listTopics: () => listTopics(ctx),
    addTopic: (label) => addTopic(ctx, label),
    renameTopic: (id, label) => renameTopic(ctx, id, label),
    deleteTopic: (id) => deleteTopic(ctx, id),
    saveBookNotes: (id, request) => saveBookNotes(ctx, id, request),
    summarizeBook: (id, request, options) => summarizeBookService(ctx, id, request, options),
  };
}
