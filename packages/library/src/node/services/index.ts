/**
 * Services layer (W3a): the one implementation of every admin operation (PLAN §7), shared by the Hono server and the
 * `elib` CLI. Every function takes a `ServiceContext`; `createServices(ctx)` binds them for the server.
 */
import type {
  BookPatch,
  BookWriteResponse,
  BulkUpdateRequest,
  BulkUpdateResponse,
  CoverCandidatesResponse,
  CreateBookRequest,
  DeleteBookResponse,
  DeleteTopicResponse,
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
export { DriveFailedError, ServiceError } from "./errors.ts";
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
export { type SummarizeServiceOptions, summarizeBookService } from "./summary.ts";
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
  summarizeBook(
    id: string,
    request: SummarizeRequest,
    options?: SummarizeServiceOptions,
  ): Promise<SummarizeResponse>;
}

export function createServices(ctx: ServiceContext): Services {
  return {
    ctx,
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
    summarizeBook: (id, request, options) => summarizeBookService(ctx, id, request, options),
  };
}
