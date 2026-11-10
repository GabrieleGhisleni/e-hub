/**
 * Remote path guard. Drive is the only durable copy of the EPUBs (PLAN §14), so every path handed to rclone is
 * checked first: it is relative to the remote root, has no `.`/`..`/empty segments, lies inside `drive.root`, and,
 * for anything that writes, moves or deletes, inside one of the two trees (`<root>/<koboTree>`, `<root>/<archiveTree>`).
 */
import type { DriveConfig } from "../../shared/config.ts";
import { type DriveTree, driveTreeDir } from "../../shared/paths.ts";

export class UnsafeRemotePathError extends Error {
  readonly path: string;
  constructor(remotePath: string, reason: string) {
    super(`refusing remote path ${JSON.stringify(remotePath)}: ${reason}`);
    this.name = "UnsafeRemotePathError";
    this.path = remotePath;
  }
}

/**
 * - `read`: a folder to list (lsjson, md5sum): `drive.root` itself or anything under it.
 * - `read-file`: a file to read (download): strictly under `drive.root`.
 * - `tree-dir`: a folder to write in (mkdir, `rmdirs --leave-root`): a tree folder or anything under it.
 * - `tree-entry`: a file or folder to create, move or delete: strictly under a tree folder.
 */
export type RemotePathAccess = "read" | "read-file" | "tree-dir" | "tree-entry";

// oxlint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const DRIVE_TREES: readonly DriveTree[] = ["kobo", "archive"];

/** Throws `UnsafeRemotePathError` unless `remotePath` is allowed for `access`. Returns the tree it lies in, if any. */
export function assertSafeRemotePath(
  drive: DriveConfig,
  remotePath: string,
  access: RemotePathAccess,
): DriveTree | null {
  if (typeof remotePath !== "string") {
    throw new UnsafeRemotePathError(String(remotePath), "not a string");
  }
  if (CONTROL_CHARS.test(remotePath)) {
    throw new UnsafeRemotePathError(remotePath, "control characters are not allowed");
  }
  if (remotePath.includes("\\")) {
    throw new UnsafeRemotePathError(remotePath, "backslashes are not allowed");
  }
  if (remotePath.startsWith("/")) {
    throw new UnsafeRemotePathError(remotePath, "absolute paths are not allowed");
  }
  if (remotePath !== "") {
    for (const segment of remotePath.split("/")) {
      if (segment === "") throw new UnsafeRemotePathError(remotePath, "empty path segment");
      if (segment === "." || segment === "..") {
        throw new UnsafeRemotePathError(remotePath, `"${segment}" segments are not allowed`);
      }
    }
  }

  const strictlyInside = (parent: string): boolean =>
    remotePath !== "" && (parent === "" || remotePath.startsWith(`${parent}/`));
  const inside = (parent: string): boolean => remotePath === parent || strictlyInside(parent);

  if (access === "read" || access === "read-file") {
    const ok = access === "read" ? inside(drive.root) : strictlyInside(drive.root);
    if (!ok) {
      throw new UnsafeRemotePathError(
        remotePath,
        access === "read-file"
          ? `not a file inside the drive root "${drive.root}"`
          : `outside the drive root "${drive.root}"`,
      );
    }
    return treeOf(drive, remotePath);
  }

  const tree = treeOf(drive, remotePath);
  if (tree === null) {
    throw new UnsafeRemotePathError(
      remotePath,
      `writes are only allowed inside "${driveTreeDir(drive, "kobo")}" or "${driveTreeDir(drive, "archive")}"`,
    );
  }
  if (access === "tree-entry" && remotePath === driveTreeDir(drive, tree)) {
    throw new UnsafeRemotePathError(
      remotePath,
      "the tree folder itself cannot be moved or deleted",
    );
  }
  return tree;
}

/** The tree `remotePath` lies in (the tree folder itself included), or null. */
export function treeOf(drive: DriveConfig, remotePath: string): DriveTree | null {
  for (const tree of DRIVE_TREES) {
    const dir = driveTreeDir(drive, tree);
    if (remotePath === dir || remotePath.startsWith(`${dir}/`)) return tree;
  }
  return null;
}

/**
 * Rejects configs where the two trees are the same folder (or differ only in case, as on FAT32): reconcile would
 * then shuffle files between "both" trees forever.
 */
export function assertDistinctTrees(drive: DriveConfig): void {
  const kobo = driveTreeDir(drive, "kobo");
  const archive = driveTreeDir(drive, "archive");
  if (kobo.toLowerCase() === archive.toLowerCase()) {
    throw new UnsafeRemotePathError(kobo, "the Kobo and Archive trees must be different folders");
  }
}
