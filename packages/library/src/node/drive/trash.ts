/**
 * Explicit deletion of a book's files (PLAN §7.5, the only operation that deletes on Drive on purpose): every file
 * with the book's ID in either tree goes to the Drive trash (recoverable for 30 days). Callers remove the repo folder
 * only when the report has no errors.
 */
import { type ReconcileReport, emptyReconcileReport } from "../../shared/api.ts";
import { assertBookId } from "../repo/paths.ts";
import type { DriveContext } from "./context.ts";
import { executePlan } from "./execute.ts";
import { type PlanStep, emptiedFolders } from "./plan.ts";
import { isDryRun, listingFailed, rcloneFor } from "./reconcile.ts";
import { type LibraryFile, listLibraryFiles } from "./remote-index.ts";

export interface TrashBookOptions {
  dryRun?: boolean;
}

export async function trashBookFiles(
  ctx: DriveContext,
  id: string,
  options: TrashBookOptions = {},
): Promise<ReconcileReport> {
  assertBookId(id);
  const dryRun = isDryRun(ctx, options);
  const report = emptyReconcileReport(dryRun);
  const rclone = rcloneFor(ctx, dryRun);

  let files: LibraryFile[];
  try {
    files = await listLibraryFiles(rclone, ctx.drive);
  } catch (error) {
    report.errors.push(listingFailed(error));
    return report;
  }

  const steps: PlanStep[] = files
    .filter((f) => f.id === id)
    .map((f) => ({ type: "trash", tree: f.tree, from: f.path, bookId: id }));
  if (steps.length === 0) {
    report.warnings.push({
      code: "no-files",
      bookId: id,
      message: `no Drive file has the ID ${id} in its name`,
    });
    return report;
  }
  steps.push(...emptiedFolders(ctx.drive, files, steps));
  await executePlan(steps, report, { ctx, rclone, dryRun, files });
  return report;
}
