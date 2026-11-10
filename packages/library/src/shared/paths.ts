import type { DriveConfig } from "./config.ts";
import { driveFileName, topicFolderName } from "./naming.ts";
import type { Book, Topic } from "./schema.ts";

export type DriveTree = "kobo" | "archive";

/** Where a book's two files belong, as posix paths relative to the rclone remote root. */
export interface DrivePaths {
  kepub: string;
  epub: string;
}

export class UnknownTopicError extends Error {
  readonly topicId: string;
  constructor(topicId: string) {
    super(`unknown topic "${topicId}" (not in topics.json)`);
    this.name = "UnknownTopicError";
    this.topicId = topicId;
  }
}

function joinPosix(...segments: string[]): string {
  return segments.filter((s) => s !== "").join("/");
}

/** `<root>/<tree name>`, e.g. `Rakuten Kobo` (root "") or `Libri-test/Archivio`. */
export function driveTreeDir(drive: DriveConfig, tree: DriveTree): string {
  return joinPosix(drive.root, tree === "kobo" ? drive.koboTree : drive.archiveTree);
}

/** Folder that holds a topic's files in one tree: the tree itself when that tree has no topic subfolders. */
export function driveTopicDir(drive: DriveConfig, tree: DriveTree, topicLabel: string): string {
  const withSubfolder =
    tree === "kobo" ? drive.topicSubfolders.kobo : drive.topicSubfolders.archive;
  return withSubfolder
    ? joinPosix(driveTreeDir(drive, tree), topicFolderName(topicLabel))
    : driveTreeDir(drive, tree);
}

/** `<remote>:<path>`, the form rclone expects. */
export function remoteSpec(drive: Pick<DriveConfig, "remote">, path: string): string {
  return `${drive.remote}:${path}`;
}

/**
 * Expected Drive paths of a book's files, derived only from config, topic label, author, title and ID (PLAN §6).
 * Throws `UnknownTopicError` when `book.topic` is not in `topics`.
 */
export function expectedDrivePaths(
  book: Pick<Book, "id" | "title" | "authors" | "topic">,
  topics: readonly Pick<Topic, "id" | "label">[],
  drive: DriveConfig,
): DrivePaths {
  const topic = topics.find((t) => t.id === book.topic);
  if (!topic) throw new UnknownTopicError(book.topic);
  return {
    kepub: joinPosix(driveTopicDir(drive, "kobo", topic.label), driveFileName(book, "kepub")),
    epub: joinPosix(driveTopicDir(drive, "archive", topic.label), driveFileName(book, "epub")),
  };
}
