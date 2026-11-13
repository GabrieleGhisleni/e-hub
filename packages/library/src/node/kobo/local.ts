/**
 * The transport of `transport.ts` on a local folder (node:fs). Tests use it, and so does a Kobo mounted over USB
 * (`ELIB_KOBO_LOCAL_DIR`, see context.ts). Same semantics as `sshTransport`: same path rules, same failures.
 */
import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { md5File } from "./duplicates.ts";
import { type KoboEntry, type KoboTransport, assertSafeRelPath } from "./transport.ts";

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function byName(a: KoboEntry, b: KoboEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function localTransport(dir: string): KoboTransport {
  const root = path.resolve(dir);
  const at = (rel: string): string => path.join(root, ...rel.split("/"));
  const tempNear = (rel: string): string =>
    path.join(path.dirname(at(rel)), `.elib-upload-${randomBytes(8).toString("hex")}`);

  async function exists(file: string): Promise<boolean> {
    try {
      await fsp.lstat(file);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  return {
    description: root,

    async list(): Promise<KoboEntry[]> {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort(byName);
    },

    async md5(relPaths: readonly string[]): Promise<Map<string, string>> {
      const result = new Map<string, string>();
      for (const rel of relPaths) {
        assertSafeRelPath(rel);
        const file = at(rel);
        try {
          const info = await fsp.stat(file);
          if (!info.isFile()) continue;
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        result.set(rel, await md5File(file));
      }
      return result;
    },

    async readFile(relPath: string): Promise<string | null> {
      assertSafeRelPath(relPath);
      try {
        return await fsp.readFile(at(relPath), "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async upload(localPath: string, relPath: string): Promise<void> {
      assertSafeRelPath(relPath);
      const target = at(relPath);
      const temp = tempNear(relPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.copyFile(localPath, temp);
        await fsp.rename(temp, target);
      } finally {
        await fsp.rm(temp, { force: true });
      }
    },

    async writeFile(relPath: string, content: string): Promise<void> {
      assertSafeRelPath(relPath);
      const target = at(relPath);
      const temp = tempNear(relPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.writeFile(temp, content, "utf8");
        await fsp.rename(temp, target);
      } finally {
        await fsp.rm(temp, { force: true });
      }
    },

    async rename(from: string, to: string): Promise<void> {
      assertSafeRelPath(from);
      assertSafeRelPath(to);
      if (await exists(at(to))) {
        throw new Error(`cannot rename ${from}: ${to} already exists`);
      }
      await fsp.rename(at(from), at(to));
    },

    async remove(relPath: string): Promise<void> {
      assertSafeRelPath(relPath);
      await fsp.rm(at(relPath), { recursive: true, force: true });
    },

    async flush(): Promise<void> {
      // Nothing to flush on a local folder.
    },
  };
}
