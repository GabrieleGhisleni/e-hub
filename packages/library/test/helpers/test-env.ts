import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElibConfig } from "../../src/shared/config.ts";
import { makeTempDataDir } from "./data-dir.ts";

export interface TestEnv {
  dataDir: string;
  cacheDir: string;
  configPath: string;
  /** Temp folder standing in for the Kobo's `booksDir` (used through `localTransport`). */
  koboDir: string;
  /**
   * Env for `loadConfig({ env })` and for child processes:
   * ELIB_CONFIG, ELIB_DATA_DIR, ELIB_CACHE_DIR and ELIB_KOBO_LOCAL_DIR (the Kobo folder) all point into the temp dir.
   */
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/**
 * Full isolated environment for integration tests: temp data dir with fixture topics, temp cache, a temp folder as the
 * Kobo's books dir and an elib.config.json pointing at them.
 */
export async function createTestEnv(
  overrides: { kobo?: Partial<ElibConfig["kobo"]> } = {},
): Promise<TestEnv> {
  const data = await makeTempDataDir();
  const cacheDir = path.join(data.root, "cache");
  const koboDir = path.join(data.root, "kobo");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(koboDir, { recursive: true });
  const config: ElibConfig = {
    kobo: {
      host: "root@127.0.0.1",
      port: 2222,
      identityFile: path.join(data.root, "no-key"),
      booksDir: "/mnt/onboard/books",
      ...overrides.kobo,
    },
    cache: { dir: cacheDir },
    server: { port: 8787, allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"] },
    site: { basePath: "/e-library/" },
  };
  const configPath = path.join(data.root, "elib.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    dataDir: data.dataDir,
    cacheDir,
    configPath,
    koboDir,
    env: {
      ELIB_CONFIG: configPath,
      ELIB_DATA_DIR: data.dataDir,
      ELIB_CACHE_DIR: cacheDir,
      ELIB_KOBO_LOCAL_DIR: koboDir,
    },
    cleanup: data.cleanup,
  };
}
