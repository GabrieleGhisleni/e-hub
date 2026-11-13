import path from "node:path";
import type { KoboConfig } from "../../shared/config.ts";
import type { LoadedConfig } from "../config/index.ts";
import type { ConvertToKepubOptions } from "../kepub/index.ts";
import { localTransport } from "./local.ts";
import { sshTransport } from "./ssh.ts";
import type { KoboTransport } from "./transport.ts";

/** What the Kobo operations need from the loaded config (a full `LoadedConfig` fits). */
export type KoboContextConfig = Pick<LoadedConfig, "kobo" | "dataDir" | "cache">;

/** Everything the Kobo operations need; built once by the server and the CLI. */
export interface KoboContext {
  readonly kobo: KoboConfig;
  /** Absolute `data/` dir (topics.json, books/). */
  readonly dataDir: string;
  /** Absolute cache dir (see src/node/cache): the only copy of the EPUBs and KEPUBs besides the Kobo. */
  readonly cacheDir: string;
  readonly transport: KoboTransport;
  /** Options for every kepubify run (env, binary, timeout). */
  readonly kepubify: ConvertToKepubOptions;
  /** A dry-run context never writes, whatever the per-call options say. */
  readonly dryRun: boolean;
}

export interface KoboContextOptions {
  /** Env of the ssh and kepubify processes. */
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  /**
   * Prebuilt transport (tests: `localTransport(dir)`). Otherwise `ELIB_KOBO_LOCAL_DIR` in `env` (default
   * `process.env`) selects `localTransport` on that folder (CLI tests, or a Kobo mounted over USB), else
   * `sshTransport(config.kobo)`.
   */
  transport?: KoboTransport;
  sshBinary?: string;
  sshTimeoutMs?: number;
  kepubifyBinary?: string;
  kepubifyTimeoutMs?: number;
}

export function createKoboContext(
  config: KoboContextConfig,
  options: KoboContextOptions = {},
): KoboContext {
  const localDir = (options.env ?? process.env).ELIB_KOBO_LOCAL_DIR?.trim();
  return {
    kobo: config.kobo,
    dataDir: path.resolve(config.dataDir),
    cacheDir: path.resolve(config.cache.dir),
    transport:
      options.transport ??
      (localDir ? localTransport(path.resolve(localDir)) : undefined) ??
      sshTransport(config.kobo, {
        ...(options.env ? { env: options.env } : {}),
        ...(options.sshBinary ? { binary: options.sshBinary } : {}),
        ...(options.sshTimeoutMs ? { timeoutMs: options.sshTimeoutMs } : {}),
      }),
    kepubify: {
      ...(options.env ? { env: options.env } : {}),
      ...(options.kepubifyBinary ? { binary: options.kepubifyBinary } : {}),
      ...(options.kepubifyTimeoutMs ? { timeoutMs: options.kepubifyTimeoutMs } : {}),
    },
    dryRun: options.dryRun ?? false,
  };
}
