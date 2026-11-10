import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElibConfig } from "../../src/shared/config.ts";
import { makeTempDataDir } from "./data-dir.ts";
import { type LocalRemote, createLocalRemote } from "./rclone.ts";

export interface TestEnv {
  dataDir: string;
  cacheDir: string;
  configPath: string;
  remote: LocalRemote;
  /**
   * Env for `loadConfig({ env })` and for child processes (CLI, rclone):
   * ELIB_CONFIG, ELIB_DATA_DIR, ELIB_CACHE_DIR and RCLONE_CONFIG all point into the temp dir.
   */
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/**
 * Full isolated environment for integration tests (W2b, W3a): temp data dir with fixture topics, temp cache,
 * a local rclone remote and an elib.config.json pointing at it.
 */
export async function createTestEnv(
  overrides: { drive?: Partial<ElibConfig["drive"]> } = {},
): Promise<TestEnv> {
  const data = await makeTempDataDir();
  const remote = await createLocalRemote();
  const cacheDir = path.join(data.root, "cache");
  await mkdir(cacheDir, { recursive: true });
  const config: ElibConfig = {
    drive: remote.driveConfig(overrides.drive),
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
    remote,
    env: {
      ...remote.env,
      ELIB_CONFIG: configPath,
      ELIB_DATA_DIR: data.dataDir,
      ELIB_CACHE_DIR: cacheDir,
    },
    cleanup: async () => {
      await remote.cleanup();
      await data.cleanup();
    },
  };
}
