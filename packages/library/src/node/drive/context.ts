import path from "node:path";
import type { DriveConfig } from "../../shared/config.ts";
import type { LoadedConfig } from "../config/index.ts";
import type { ConvertToKepubOptions } from "../kepub/index.ts";
import { type Rclone, createRclone } from "./rclone.ts";

/** What the Drive operations need from the loaded config (a full `LoadedConfig` fits). */
export type DriveContextConfig = Pick<LoadedConfig, "drive" | "dataDir" | "cache">;

/** Everything the Drive operations need; built once by the server and the CLI (W3a). */
export interface DriveContext {
  readonly config: DriveContextConfig;
  readonly drive: DriveConfig;
  /** Absolute `data/` dir (topics.json, books/). */
  readonly dataDir: string;
  /** Absolute cache dir (see src/node/cache). */
  readonly cacheDir: string;
  readonly rclone: Rclone;
  /** Options for every kepubify run (env, binary, timeout). */
  readonly kepubify: ConvertToKepubOptions;
  /** A dry-run context never writes, whatever the per-call options say. */
  readonly dryRun: boolean;
}

export interface DriveContextOptions {
  /** Env of the rclone and kepubify processes (tests: the local remote's env with RCLONE_CONFIG). */
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  rcloneBinary?: string;
  kepubifyBinary?: string;
  rcloneTimeoutMs?: number;
  kepubifyTimeoutMs?: number;
}

export function createDriveContext(
  config: DriveContextConfig,
  options: DriveContextOptions = {},
): DriveContext {
  const dryRun = options.dryRun ?? false;
  return {
    config,
    drive: config.drive,
    dataDir: path.resolve(config.dataDir),
    cacheDir: path.resolve(config.cache.dir),
    rclone: createRclone({
      drive: config.drive,
      dryRun,
      ...(options.env ? { env: options.env } : {}),
      ...(options.rcloneBinary ? { binary: options.rcloneBinary } : {}),
      ...(options.rcloneTimeoutMs ? { timeoutMs: options.rcloneTimeoutMs } : {}),
    }),
    kepubify: {
      ...(options.env ? { env: options.env } : {}),
      ...(options.kepubifyBinary ? { binary: options.kepubifyBinary } : {}),
      ...(options.kepubifyTimeoutMs ? { timeoutMs: options.kepubifyTimeoutMs } : {}),
    },
    dryRun,
  };
}
