/**
 * Runs a reconcile plan: one action at a time, each with its own error handling (a failed action is reported and the
 * run goes on). In dry-run the same code runs against a dry-run rclone (writes only recorded, the path guard still
 * applies) and kepubify is skipped, so the report lists exactly what a real run would attempt and nothing is written.
 */
import type { ReconcileAction, ReconcileMessage, ReconcileReport } from "../../shared/api.ts";
import { driveTreeDir } from "../../shared/paths.ts";
import { convertToKepub } from "../kepub/index.ts";
import type { DriveContext } from "./context.ts";
import { UnsafeRemotePathError } from "./guard.ts";
import { type PlanStep, emptiedFolders } from "./plan.ts";
import { type Rclone, RcloneError } from "./rclone.ts";
import type { LibraryFile } from "./remote-index.ts";

/** An error with a report code (e.g. `kepub-failed`). */
class StepError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

export interface ExecuteOptions {
  ctx: DriveContext;
  /** Must be a dry-run instance when `dryRun` is true. */
  rclone: Rclone;
  dryRun: boolean;
  /** The listing the plan was made from (to work out which folders end up empty). */
  files: readonly Pick<LibraryFile, "path">[];
}

export async function executePlan(
  steps: readonly PlanStep[],
  report: ReconcileReport,
  options: ExecuteOptions,
): Promise<void> {
  const { ctx, rclone, dryRun } = options;
  if (dryRun && !rclone.dryRun) throw new Error("executePlan: dry run with a live rclone");
  const okStatus = dryRun ? "planned" : "done";
  const succeeded: PlanStep[] = [];
  /** Destinations of moves that failed (the file is still at its old path). */
  const failedMoves = new Set<string>();

  for (const step of steps) {
    if (step.type === "rmdir") continue; // recomputed below from what actually succeeded
    const action = toAction(step);
    report.actions.push(action);
    try {
      await runStep(step);
      action.status = okStatus;
      succeeded.push(step);
    } catch (error) {
      action.status = "failed";
      report.errors.push(failure(step, error));
      if (step.type === "move") failedMoves.add(step.to);
    }
  }

  // Folders left empty by the moves/trash that succeeded: one `rmdirs --leave-root` per tree.
  const emptied = emptiedFolders(ctx.drive, options.files, succeeded);
  for (const tree of ["kobo", "archive"] as const) {
    const dirs = emptied.filter((s) => s.tree === tree);
    if (dirs.length === 0) continue;
    const actions = dirs.map((s) => toAction(s));
    report.actions.push(...actions);
    const treeDir = driveTreeDir(ctx.drive, tree);
    try {
      await rclone.rmdirs(treeDir);
      for (const a of actions) a.status = okStatus;
    } catch (error) {
      for (const a of actions) a.status = "failed";
      report.errors.push(failure({ type: "rmdir", tree, from: treeDir }, error));
    }
  }

  async function runStep(step: PlanStep): Promise<void> {
    switch (step.type) {
      case "move":
        await rclone.moveTo(step.from, step.to);
        return;
      case "trash":
        await rclone.deleteFile(step.from);
        return;
      case "upload": {
        const regen = step.regenerate;
        if (regen?.download) {
          const { remote, remoteBeforeMove } = regen.download;
          const source = failedMoves.has(remote) && remoteBeforeMove ? remoteBeforeMove : remote;
          try {
            await rclone.download(source, regen.epub);
          } catch (error) {
            throw new StepError(
              "download-failed",
              `cannot download ${source} into the cache: ${(error as Error).message}`,
              error,
            );
          }
        }
        if (regen && !dryRun) {
          try {
            await convertToKepub(regen.epub, step.from, ctx.kepubify);
          } catch (error) {
            throw new StepError(
              "kepub-failed",
              `cannot regenerate the KEPUB: ${(error as Error).message}`,
              error,
            );
          }
        }
        await rclone.copyTo(step.from, step.to);
        return;
      }
      case "rmdir":
        return;
    }
  }
}

export function toAction(step: PlanStep): ReconcileAction {
  return {
    type: step.type,
    status: "planned",
    ...("bookId" in step && step.bookId ? { bookId: step.bookId } : {}),
    tree: step.tree,
    from: step.from,
    ...("to" in step ? { to: step.to } : {}),
  };
}

export function failure(step: PlanStep, error: unknown): ReconcileMessage {
  const code =
    error instanceof StepError
      ? error.code
      : error instanceof UnsafeRemotePathError
        ? "unsafe-path"
        : error instanceof RcloneError
          ? "rclone-failed"
          : "action-failed";
  const what =
    step.type === "move"
      ? `move ${step.from} → ${step.to}`
      : step.type === "upload"
        ? `upload ${step.from} → ${step.to}`
        : step.type === "trash"
          ? `trash ${step.from}`
          : `remove empty folders under ${step.from}`;
  return {
    code,
    message: `${what} failed: ${error instanceof Error ? error.message : String(error)}`,
    ...("bookId" in step && step.bookId ? { bookId: step.bookId } : {}),
    path: "to" in step ? step.to : step.from,
  };
}
