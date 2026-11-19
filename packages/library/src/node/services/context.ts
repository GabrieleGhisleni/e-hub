/**
 * Service context: everything the services need, injected so tests can run against temp dirs, a local Kobo folder
 * (`localTransport`) and a fake `fetch`. The server and the CLI build exactly one per process. The Kobo is reached
 * through `ctx.kobo` (docs/kobo-ssh-migration.md); the cache is the durable local copy of every book.
 */
import { API_LIMITS } from "../../shared/api.ts";
import type { LoadedConfig } from "../config/index.ts";
import { type KoboContext, type KoboContextOptions, createKoboContext } from "../kobo/index.ts";
import { RateLimiter } from "../openlibrary/index.ts";
import { userEnv } from "@ehub/store";
import { type SummaryModel, summaryModelFromEnv } from "../summary/llm.ts";
import { LOCK_FILE_NAME, Mutex, ProcessLock } from "./mutex.ts";
import path from "node:path";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, error) => console.error(message, ...(error === undefined ? [] : [error])),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface ServiceLimits {
  /** Largest EPUB accepted by `analyzeUpload`. */
  epubMaxBytes: number;
  /** Largest cover image accepted by `setBookCover`. */
  imageMaxBytes: number;
  /** Staging dirs older than this are removed by `cleanupStaleUploads` (default 24h). */
  uploadTtlMs: number;
}

export interface ServiceContext {
  readonly config: LoadedConfig;
  /** Absolute `data/` dir. */
  readonly dataDir: string;
  /** Absolute cache dir. */
  readonly cacheDir: string;
  /** The Kobo (SSH, or a local folder in tests): every book file write goes through `kobo`. */
  readonly kobo: KoboContext;
  /** Used for Open Library only (tests inject a fake: no network in tests). */
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly logger: Logger;
  /** Open Library throttle shared by every lookup of this process (100 requests / 5 minutes). */
  readonly openLibraryLimiter: RateLimiter;
  readonly limits: ServiceLimits;
  /** Serializes the write operations. */
  readonly lock: Mutex;
  /** Cross-process lock file (`<cache>/.elib.lock`): hold it for a whole CLI run (`sync`, `import`). */
  readonly processLock: ProcessLock;
  /** Summary model of the configuration; throws `AiConfigError` when EHUB_AI_* is missing or invalid. */
  readonly summaryModel: () => SummaryModel | Promise<SummaryModel>;
  /** Books being summarized by this process: a second run for the same book is refused (409 `busy`). */
  readonly summariesInProgress: Set<string>;
}

export interface ServiceContextOptions extends KoboContextOptions {
  /** Prebuilt Kobo context (otherwise built from `config` with the Kobo options above). */
  kobo?: KoboContext;
  fetch?: typeof fetch;
  now?: () => Date;
  logger?: Logger;
  openLibraryLimiter?: RateLimiter;
  limits?: Partial<ServiceLimits>;
  /** Summary model (default: EHUB_AI_* from `env`, else `process.env`). Tests inject a mock model here. */
  summaryModel?: () => SummaryModel | Promise<SummaryModel>;
}

export function createServiceContext(
  config: LoadedConfig,
  options: ServiceContextOptions = {},
): ServiceContext {
  const {
    kobo,
    fetch: fetchImpl,
    now,
    logger,
    openLibraryLimiter,
    limits,
    summaryModel,
    ...koboOptions
  } = options;
  const koboCtx = kobo ?? createKoboContext(config, koboOptions);
  const processLock = new ProcessLock(path.join(koboCtx.cacheDir, LOCK_FILE_NAME));
  return {
    config,
    dataDir: koboCtx.dataDir,
    cacheDir: koboCtx.cacheDir,
    kobo: koboCtx,
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
    now: now ?? (() => new Date()),
    logger: logger ?? consoleLogger,
    openLibraryLimiter: openLibraryLimiter ?? new RateLimiter(),
    limits: {
      epubMaxBytes: API_LIMITS.epubMaxBytes,
      imageMaxBytes: API_LIMITS.imageMaxBytes,
      uploadTtlMs: 24 * 60 * 60 * 1000,
      ...limits,
    },
    lock: new Mutex(processLock),
    processLock,
    summaryModel: summaryModel ??
      (async () => summaryModelFromEnv(await userEnv(options.env ?? process.env))),
    summariesInProgress: new Set<string>(),
  };
}
