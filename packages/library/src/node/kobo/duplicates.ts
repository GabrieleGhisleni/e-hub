/**
 * Duplicate check at upload time (PLAN §7.2, adapted to the Kobo): MD5 of the local file against the EPUBs already in
 * the local cache (`<cache>/books/<id>/book.epub`). Nothing is read from the Kobo, and no hash is written to the repo.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isBookId } from "../../shared/ids.ts";
import { cacheBooksDir, cachedEpubPath } from "../cache/index.ts";

/** Same shape as the `md5` variant of `DuplicateMatch` in src/shared/api.ts. */
export interface Md5Duplicate {
  kind: "md5";
  /** Local cache path of the matching EPUB. */
  path: string;
  /** Book ID (the cache folder name), null when it is not one. */
  bookId: string | null;
}

/** Lowercase hex MD5 of a local file (streamed). */
export function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Cached EPUBs with the same MD5 as `localEpubPath`, sorted by path. A missing books dir means no duplicates. */
export async function findDuplicatesInCache(
  cacheDir: string,
  localEpubPath: string,
): Promise<Md5Duplicate[]> {
  const booksRoot = cacheBooksDir(path.resolve(cacheDir));
  let folders;
  try {
    folders = await readdir(booksRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const md5 = await md5File(localEpubPath);
  const size = (await stat(localEpubPath)).size;
  const matches: Md5Duplicate[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !isBookId(folder.name)) continue;
    const file = cachedEpubPath(path.resolve(cacheDir), folder.name);
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    if (!info.isFile() || info.size !== size) continue;
    if ((await md5File(file)) === md5) {
      matches.push({ kind: "md5", path: file, bookId: folder.name });
    }
  }
  return matches.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
