/**
 * Duplicate check at upload time (PLAN §7.2): MD5 of the uploaded file against `rclone md5sum` of the Archive tree.
 * Drive keeps the MD5 of every file, so nothing is downloaded, and no hash is ever written to the repo.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { parseDriveFileName } from "../../shared/naming.ts";
import { driveTreeDir } from "../../shared/paths.ts";
import type { DriveContext } from "./context.ts";

/** Same shape as the `md5` variant of `DuplicateMatch` in src/shared/api.ts. */
export interface Md5Duplicate {
  kind: "md5";
  /** Remote path of the matching file in the Archive tree. */
  path: string;
  /** Book ID from the file name, null when the name is not ours. */
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

/** Archive files with the same MD5 as `localEpubPath`, sorted by path. A missing Archive tree means no duplicates. */
export async function findDuplicatesByMd5(
  ctx: DriveContext,
  localEpubPath: string,
): Promise<Md5Duplicate[]> {
  const [md5, remote] = await Promise.all([
    md5File(localEpubPath),
    ctx.rclone.md5sum(driveTreeDir(ctx.drive, "archive"), { missingOk: true }),
  ]);
  // md5sum hashes in parallel: its output order varies, so sort by path.
  return remote
    .filter((entry) => entry.md5 === md5)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => ({
      kind: "md5",
      path: entry.path,
      bookId: parseDriveFileName(entry.path)?.id ?? null,
    }));
}
