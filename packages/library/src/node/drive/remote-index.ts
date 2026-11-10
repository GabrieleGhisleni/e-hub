/**
 * Remote index: one recursive, files-only listing of each tree, with every file name parsed back into
 * `{ id, kind }` (PLAN §6: the ID in the name identifies the book even after a manual edit of book.json).
 */
import type { DriveConfig } from "../../shared/config.ts";
import { type DriveFileKind, parseDriveFileName } from "../../shared/naming.ts";
import { type DriveTree, driveTreeDir } from "../../shared/paths.ts";
import { DRIVE_TREES } from "./guard.ts";
import type { Rclone } from "./rclone.ts";

export interface LibraryFile {
  tree: DriveTree;
  /** Path relative to the remote root, e.g. `Archivio/Narrativa/Ada Esempio - Prove [7k2m9q4t].epub`. */
  path: string;
  name: string;
  size: number;
  modTime: string;
  /** False when the name has no `[<id>].epub` / `[<id>].kepub.epub` suffix (not a file this app made). */
  recognized: boolean;
  /** Book ID from the name (recognized files only). */
  id?: string;
  /** `kepub` for `….kepub.epub`, `epub` for `….epub` (recognized files only). */
  kind?: DriveFileKind;
}

/**
 * Lists every file of both trees (2 rclone calls). A tree folder that does not exist yet counts as empty.
 * Sorted by tree (Kobo first) and path, so reports do not depend on the backend's listing order.
 */
export async function listLibraryFiles(
  rclone: Rclone,
  drive: DriveConfig = rclone.drive,
): Promise<LibraryFile[]> {
  const files: LibraryFile[] = [];
  for (const tree of DRIVE_TREES) {
    const treeFiles: LibraryFile[] = [];
    const entries = await rclone.lsjson(driveTreeDir(drive, tree), {
      recursive: true,
      filesOnly: true,
      missingOk: true,
    });
    for (const entry of entries) {
      if (entry.isDir) continue;
      const parsed = parseDriveFileName(entry.name);
      treeFiles.push({
        tree,
        path: entry.path,
        name: entry.name,
        size: entry.size,
        modTime: entry.modTime,
        recognized: parsed !== null,
        ...(parsed ? { id: parsed.id, kind: parsed.kind } : {}),
      });
    }
    treeFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    files.push(...treeFiles);
  }
  return files;
}
