/** `elib sync [--dry-run] [--prune] [--force] [--json]`: make Drive mirror the repo (PLAN §11). Exit 1 on errors. */
import { emptyReconcileReport } from "../../../shared/api.ts";
import { assessPrune, reconcile } from "../../drive/index.ts";
import { readAllBooks } from "../../repo/index.ts";
import { formatReport } from "../format.ts";
import type { CliCommand } from "../program.ts";

export const syncCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("sync")
      .description(
        "Make Drive mirror the repo: upload missing files from the cache, move misplaced ones, report orphans",
      )
      .option("--dry-run", "only show what would be done (no change at all)")
      .option("--prune", "move orphan, duplicate and unrecognized files to the Drive trash")
      .option("--force", "with --prune: skip the safety checks (empty data dir, too many files)")
      .option("--json", "print the report as JSON")
      .action(
        async (options: { dryRun?: boolean; prune?: boolean; force?: boolean; json?: boolean }) => {
          const dryRun = options.dryRun === true;
          const prune = options.prune === true;
          const services = ctx.services();
          const drive = services.drive;
          const books = (await readAllBooks(drive.dataDir)).books.length;
          // Always say which repo is being mirrored (a stale ELIB_DATA_DIR is the classic mistake).
          ctx.err(`Data dir: ${drive.dataDir} (${books} book(s))`);
          if (prune) {
            ctx.err(
              dryRun
                ? "--prune (dry run): listing the orphan, duplicate and unrecognized files that would go to the Drive trash."
                : "--prune: orphan, duplicate and unrecognized files go to the Drive trash (recoverable there for 30 days).",
            );
          }

          const run = async () => {
            if (prune && !dryRun && options.force !== true) {
              // Without books there is nothing to list: the data dir alone is reason enough to stop.
              const preview =
                books === 0
                  ? emptyReconcileReport(true)
                  : await reconcile(drive, "all", { dryRun: true, prune: true });
              const verdict = assessPrune(preview, books, drive.dataDir);
              if (verdict.refusal) {
                ctx.err(`error: --prune refused: ${verdict.refusal}.`);
                ctx.err(
                  "Check the data dir, look at what would be trashed with `elib sync --prune --dry-run`, " +
                    "and add --force only if that is really what you want.",
                );
                ctx.fail(1);
                return null;
              }
            }
            return reconcile(drive, "all", { dryRun, prune });
          };
          // A real run excludes the server and other CLI runs (R1-10); a dry run writes nothing.
          const report = dryRun ? await run() : await services.processLock.hold(run);
          if (!report) return;
          if (options.json) ctx.out(JSON.stringify(report, null, 2));
          else for (const line of formatReport(report)) ctx.out(line);
          if (report.errors.length > 0) ctx.fail(1);
        },
      );
  },
};
