/**
 * Service context: everything the services need, injected so tests can run against temp dirs, the local rclone
 * remote and a fake `fetch`. The server and the CLI build exactly one per process.
 */
import { API_LIMITS } from "../../shared/api.ts";
import type { LoadedConfig } from "../config/index.ts";
import { type DriveContext, type DriveContextOptions, createDriveContext } from "../drive/index.ts";
import { RateLimiter } from "../openlibrary/index.ts";
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
  readonly drive: DriveContext;
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
}

export interface ServiceContextOptions extends DriveContextOptions {
  /** Prebuilt Drive context (otherwise built from `config` with the Drive options above). */
  drive?: DriveContext;
  fetch?: typeof fetch;
  now?: () => Date;
  logger?: Logger;
  openLibraryLimiter?: RateLimiter;
  limits?: Partial<ServiceLimits>;
}

export function createServiceContext(
  config: LoadedConfig,
  options: ServiceContextOptions = {},
): ServiceContext {
  const {
    drive,
    fetch: fetchImpl,
    now,
    logger,
    openLibraryLimiter,
    limits,
    ...driveOptions
  } = options;
  const driveCtx = drive ?? createDriveContext(config, driveOptions);
  const processLock = new ProcessLock(path.join(driveCtx.cacheDir, LOCK_FILE_NAME));
  return {
    config,
    dataDir: driveCtx.dataDir,
    cacheDir: driveCtx.cacheDir,
    drive: driveCtx,
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
  };
}
