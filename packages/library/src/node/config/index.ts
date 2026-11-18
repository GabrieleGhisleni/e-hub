import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type ElibConfig, ElibConfigSchema, KoboConfigSchema } from "../../shared/config.ts";

/** Absolute path of the repository root (this file is `<root>/src/node/config/index.ts`). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "elib.config.json");
export const DEFAULT_DATA_DIR = path.join(REPO_ROOT, "data");

/** Validated config with resolved paths. `cache.dir` is absolute (`~` expanded). */
export type LoadedConfig = ElibConfig & {
  /** Absolute path of the config file that was read. */
  readonly configPath: string;
  readonly repoRoot: string;
  /** Absolute path of `data/` (topics.json + books/). */
  readonly dataDir: string;
};

export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/** `~` or `~/x` → home directory based path. Other paths are returned unchanged. */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

export interface LoadConfigOptions {
  /** Defaults to `process.env`. Recognized: `ELIB_CONFIG`, `ELIB_DATA_DIR`, `ELIB_CACHE_DIR`, `ELIB_KOBO_HOST`. */
  env?: NodeJS.ProcessEnv;
  /** Explicit config file; wins over `ELIB_CONFIG`. */
  configPath?: string;
}

/**
 * Reads and validates `elib.config.json` (synchronous, so the Vite config can call it).
 * Env overrides, mainly for tests: `ELIB_CONFIG` (config file), `ELIB_DATA_DIR`, `ELIB_CACHE_DIR`, and `ELIB_KOBO_HOST`
 * (the Kobo's SSH destination, which changes with DHCP). `kobo.identityFile` has `~` expanded.
 * Relative env paths resolve against the current directory; a relative `cache.dir` in the file resolves
 * against the file's directory.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const configPath = path.resolve(
    expandHome(options.configPath ?? nonEmpty(env.ELIB_CONFIG) ?? DEFAULT_CONFIG_PATH),
  );

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read config file ${configPath}: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const parsed = ElibConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`invalid config file ${configPath}:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  const config = parsed.data;

  const envCache = nonEmpty(env.ELIB_CACHE_DIR);
  const cacheDir = envCache
    ? path.resolve(expandHome(envCache))
    : path.resolve(path.dirname(configPath), expandHome(config.cache.dir));
  // Only from sources (package.json is there): the bundled API on the Pi runs from /opt/ehub, where "../../.." is just `/`.
  if (existsSync(path.join(REPO_ROOT, "package.json")) && isInsideDir(cacheDir, REPO_ROOT)) {
    throw new ConfigError(
      `cache.dir (${cacheDir}) is inside the repository (${REPO_ROOT}): cached EPUBs could end up in the public repo. ` +
        "Use a folder outside it, e.g. ~/.cache/e-library.",
    );
  }
  const envData = nonEmpty(env.ELIB_DATA_DIR);
  const dataDir = envData ? path.resolve(expandHome(envData)) : DEFAULT_DATA_DIR;

  const envKoboPort = nonEmpty(env.ELIB_KOBO_PORT);
  const koboPort = envKoboPort === undefined ? undefined : Number(envKoboPort);
  if (koboPort !== undefined && !(Number.isInteger(koboPort) && koboPort >= 1 && koboPort <= 65535)) {
    throw new ConfigError(`invalid ELIB_KOBO_PORT ${JSON.stringify(envKoboPort)}`);
  }
  const envKoboAlias = nonEmpty(env.ELIB_KOBO_HOST_KEY_ALIAS);
  const envKoboHost = nonEmpty(env.ELIB_KOBO_HOST);
  if (envKoboHost !== undefined && !KoboConfigSchema.shape.host.safeParse(envKoboHost).success) {
    throw new ConfigError(
      `invalid ELIB_KOBO_HOST ${JSON.stringify(envKoboHost)}: expected user@host`,
    );
  }

  return {
    ...config,
    kobo: {
      ...config.kobo,
      ...(envKoboHost ? { host: envKoboHost } : {}),
      ...(koboPort !== undefined ? { port: koboPort } : {}),
      ...(envKoboAlias ? { hostKeyAlias: envKoboAlias } : {}),
      identityFile: path.resolve(expandHome(config.kobo.identityFile)),
    },
    cache: { ...config.cache, dir: cacheDir },
    configPath,
    repoRoot: REPO_ROOT,
    dataDir,
  };
}

/** Realpath of `p`, or of its nearest existing ancestor with the missing tail appended. */
function realpathLoose(p: string): string {
  const missing: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(realpathSync(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing.reverse());
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `dir` is `root` or inside it (symlinks resolved, also for folders that do not exist yet). */
export function isInsideDir(dir: string, root: string): boolean {
  const relative = path.relative(realpathLoose(root), realpathLoose(dir));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
