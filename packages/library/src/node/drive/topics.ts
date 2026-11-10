/**
 * Topic rename on Drive (PLAN §7.6): the label changes in topics.json (books keep the topic ID), and the topic folder
 * is renamed in every tree that has topic subfolders. Then the books of that topic are reconciled, which moves anything
 * the folder rename did not cover (new folder already there, interrupted run, misplaced files).
 */
import { type ReconcileReport, emptyReconcileReport } from "../../shared/api.ts";
import { type DriveTree, driveTopicDir, driveTreeDir } from "../../shared/paths.ts";
import { readAllBooks, readTopics } from "../repo/index.ts";
import type { DriveContext } from "./context.ts";
import { failure } from "./execute.ts";
import { DRIVE_TREES } from "./guard.ts";
import { isDryRun, listingFailed, rcloneFor, reconcile } from "./reconcile.ts";
import type { LibraryFile } from "./remote-index.ts";

export interface RenameTopicOptions {
  dryRun?: boolean;
}

/**
 * Call after topics.json already has `newLabel`. For each tree with topic subfolders: moves the `oldLabel` folder to
 * the `newLabel` folder when the latter does not exist yet; then reconciles every book of the renamed topic.
 */
export async function renameTopicFolders(
  ctx: DriveContext,
  oldLabel: string,
  newLabel: string,
  options: RenameTopicOptions = {},
): Promise<ReconcileReport> {
  const dryRun = isDryRun(ctx, options);
  const report = emptyReconcileReport(dryRun);
  const rclone = rcloneFor(ctx, dryRun);
  const okStatus = dryRun ? "planned" : "done";
  const movedFolders: { from: string; to: string }[] = [];

  for (const tree of DRIVE_TREES) {
    if (!hasTopicSubfolders(ctx, tree)) continue;
    const from = driveTopicDir(ctx.drive, tree, oldLabel);
    const to = driveTopicDir(ctx.drive, tree, newLabel);
    if (from === to) continue;
    const treeDir = driveTreeDir(ctx.drive, tree);

    let folders: Set<string>;
    try {
      folders = await listFolders(ctx, treeDir);
    } catch (error) {
      report.errors.push(listingFailed(error));
      return report;
    }
    if (!folders.has(from)) continue;
    if (folders.has(to)) {
      report.warnings.push({
        code: "topic-folder-exists",
        path: to,
        message: `"${to}" already exists: the files in "${from}" are moved one by one`,
      });
      continue;
    }

    const reported: ReportedAction = { type: "move", status: "planned", tree, from, to };
    report.actions.push(reported);
    try {
      await rclone.moveDir(from, to);
      reported.status = okStatus;
      movedFolders.push({ from, to });
    } catch (error) {
      reported.status = "failed";
      report.errors.push(failure({ type: "move", tree, from, to }, error));
      continue;
    }

    // rclone falls back to moving file by file (leaving the empty source) when a server-side folder move is
    // not possible: clean up in that case.
    if (!dryRun) {
      try {
        if ((await listFolders(ctx, treeDir)).has(from)) {
          const rmdir: ReportedAction = { type: "rmdir", status: "planned", tree, from };
          report.actions.push(rmdir);
          try {
            await rclone.rmdirs(treeDir);
            rmdir.status = "done";
          } catch (error) {
            rmdir.status = "failed";
            report.errors.push(failure({ type: "rmdir", tree, from: treeDir }, error));
          }
        }
      } catch {
        // Only a cleanup check: the reconcile below lists again and reports real problems.
      }
    }
  }

  // Books of the renamed topic (topics.json already carries the new label).
  let ids: string[] = [];
  try {
    const topic = (await readTopics(ctx.dataDir)).find((t) => t.label === newLabel);
    if (!topic) {
      report.errors.push({
        code: "unknown-topic",
        message: `no topic labelled "${newLabel}" in topics.json: books not reconciled`,
      });
      return report;
    }
    ids = (await readAllBooks(ctx.dataDir)).books
      .filter((b) => b.topic === topic.id)
      .map((b) => b.id);
  } catch (error) {
    report.errors.push({
      code: "invalid-topics",
      message: `cannot read the repo, books not reconciled: ${(error as Error).message}`,
    });
    return report;
  }

  // In a dry run the folder move did not happen: plan the books as if it had.
  const transformFiles =
    dryRun && movedFolders.length > 0
      ? (files: LibraryFile[]): LibraryFile[] =>
          files.map((f) => {
            const moved = movedFolders.find((m) => f.path.startsWith(`${m.from}/`));
            return moved ? { ...f, path: moved.to + f.path.slice(moved.from.length) } : f;
          })
      : undefined;

  const books = await reconcile(ctx, ids, { dryRun }, transformFiles ? { transformFiles } : {});
  report.actions.push(...books.actions);
  report.warnings.push(...books.warnings);
  report.errors.push(...books.errors);
  return report;
}

type ReportedAction = ReconcileReport["actions"][number];

function hasTopicSubfolders(ctx: DriveContext, tree: DriveTree): boolean {
  return tree === "kobo" ? ctx.drive.topicSubfolders.kobo : ctx.drive.topicSubfolders.archive;
}

/** Paths of the folders right under `treeDir` (empty set when the tree does not exist yet). */
async function listFolders(ctx: DriveContext, treeDir: string): Promise<Set<string>> {
  const entries = await ctx.rclone.lsjson(treeDir, { dirsOnly: true, missingOk: true });
  return new Set(entries.filter((e) => e.isDir).map((e) => e.path));
}
