/** Shared setup for the Drive integration tests: a full test env (data + cache + local rclone remote) and helpers. */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import { type LoadedConfig, loadConfig } from "../../../src/node/config/index.ts";
import { type DriveContext, createDriveContext } from "../../../src/node/drive/index.ts";
import { readTopics, writeBook } from "../../../src/node/repo/index.ts";
import type { ElibConfig } from "../../../src/shared/config.ts";
import { type DrivePaths, expectedDrivePaths } from "../../../src/shared/paths.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { type TestEnv, createTestEnv } from "../../helpers/test-env.ts";

export const ID_A = "7k2m9q4t";
export const ID_B = "a1b2c3d4";
export const ID_C = "0123abcd";
export const ID_ORPHAN = "zzzz0000";
export const ID_INCOMPLETE = "qqqq1111";
export const ID_INVALID = "rrrr2222";

export function makeBook(id: string, extra: Partial<Book> = {}): Book {
  return {
    id,
    title: "Il giardino delle prove",
    authors: ["Ada Esempio"],
    topic: "narrativa",
    status: "to-read",
    ...extra,
  };
}

export interface DriveTestEnv {
  env: TestEnv;
  config: LoadedConfig;
  ctx: DriveContext;
  /** Writes a file straight into the local remote's folder (as if it were already on Drive). */
  put(remotePath: string, content?: string | Uint8Array): Promise<void>;
  /** Remote file content, or null when missing. */
  read(remotePath: string): Promise<Buffer | null>;
  /** Every file under the remote root, as sorted remote paths. */
  remoteFiles(): Promise<string[]>;
  /** Every directory under the remote root, as sorted remote paths. */
  remoteDirs(): Promise<string[]>;
  /** Writes book.json; optionally puts EPUB/KEPUB bytes in the cache. */
  addBook(
    book: Book,
    cache?: { epub?: string | Uint8Array; kepub?: string | Uint8Array },
  ): Promise<void>;
  /** Expected Drive paths for a book with the current topics.json. */
  expected(book: Book): Promise<DrivePaths>;
  /** Snapshot of remote + cache + data dir (path, size, mtime) to prove that nothing changed. */
  snapshot(): Promise<string[]>;
  cleanup(): Promise<void>;
}

export async function setupDrive(
  overrides: { drive?: Partial<ElibConfig["drive"]> } = {},
): Promise<DriveTestEnv> {
  const env = await createTestEnv(overrides);
  const config = loadConfig({ env: env.env });
  const ctx = createDriveContext(config, { env: env.env });
  const remoteDir = env.remote.dir;

  const walk = async (root: string, wantDirs: boolean): Promise<string[]> => {
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (entry.isDirectory()) {
          if (wantDirs) out.push(rel);
          await visit(full);
        } else if (!wantDirs) {
          out.push(rel);
        }
      }
    };
    await visit(root);
    return out.sort();
  };

  const statLine = async (root: string, label: string): Promise<string[]> => {
    const lines: string[] = [];
    for (const rel of [...(await walk(root, false)), ...(await walk(root, true))]) {
      const info = await stat(path.join(root, rel));
      lines.push(`${label}:${rel}:${info.isDirectory() ? "dir" : info.size}:${info.mtimeMs}`);
    }
    return lines.sort();
  };

  return {
    env,
    config,
    ctx,
    put: async (remotePath, content = `content of ${remotePath}`) => {
      const file = env.remote.localPath(remotePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    },
    read: async (remotePath) => {
      try {
        return await readFile(env.remote.localPath(remotePath));
      } catch {
        return null;
      }
    },
    remoteFiles: () => walk(remoteDir, false),
    remoteDirs: () => walk(remoteDir, true),
    addBook: async (book, cache = {}) => {
      await writeBook(env.dataDir, book);
      if (cache.epub !== undefined) {
        const file = cachedEpubPath(env.cacheDir, book.id);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cache.epub);
      }
      if (cache.kepub !== undefined) {
        const file = cachedKepubPath(env.cacheDir, book.id);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cache.kepub);
      }
    },
    expected: async (book) => expectedDrivePaths(book, await readTopics(env.dataDir), config.drive),
    snapshot: async () => [
      ...(await statLine(remoteDir, "remote")),
      ...(await statLine(env.cacheDir, "cache")),
      ...(await statLine(env.dataDir, "data")),
    ],
    cleanup: env.cleanup,
  };
}
