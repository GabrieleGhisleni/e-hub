/**
 * `elib sync [--dry-run] [--prune] [--force] [--no-highlights] [--json]`: make the Kobo mirror the repo
 * (docs/kobo-ssh-migration.md), then pull the KOReader highlights into `data/books/<id>/highlights.json`. Exit 1 on errors.
 */
import { emptyReconcileReport } from "../../../shared/api.ts";
import {
  type HighlightsPullReport,
  assessPrune,
  formatHighlightsReport,
  pullHighlights,
  reconcile,
} from "../../kobo/index.ts";
import { readAllBooks } from "../../repo/index.ts";
import { formatReport } from "../format.ts";
import type { CliCommand } from "../program.ts";

export const syncCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("sync")
      .description(
        "Make the Kobo mirror the repo: upload missing KEPUBs from the cache, rename files whose title/author changed, write the series metadata, report orphans",
      )
      .option("--dry-run", "only show what would be done (no change at all)")
      .option("--prune", "delete orphan and duplicate files from the Kobo (irreversible)")
      .option("--force", "with --prune: skip the safety checks (empty data dir, too many files)")
      .option("--no-highlights", "do not pull the KOReader highlights from the Kobo")
      .option("--json", "print the report as JSON")
      .action(
        async (options: {
          dryRun?: boolean;
          prune?: boolean;
          force?: boolean;
          highlights?: boolean;
          json?: boolean;
        }) => {
          const dryRun = options.dryRun === true;
          const prune = options.prune === true;
          const services = ctx.services();
          const kobo = services.kobo;
          const books = (await readAllBooks(kobo.dataDir)).books.length;
          // Always say which repo is being mirrored (a stale ELIB_DATA_DIR is the classic mistake), and where.
          ctx.err(`Data dir: ${kobo.dataDir} (${books} book(s))`);
          ctx.err(`Kobo: ${kobo.transport.description}`);
          if (prune) {
            ctx.err(
              dryRun
                ? "--prune (dry run): listing the orphan and duplicate files that would be deleted from the Kobo."
                : "--prune: orphan and duplicate files are deleted from the Kobo: there is no trash.",
            );
          }

          const run = async () => {
            if (prune && !dryRun && options.force !== true) {
              // Without books there is nothing to list: the data dir alone is reason enough to stop.
              const preview =
                books === 0
                  ? emptyReconcileReport(true)
                  : await reconcile(kobo, "all", { dryRun: true, prune: true });
              const verdict = assessPrune(preview, books, kobo.dataDir);
              if (verdict.refusal) {
                ctx.err(`error: --prune refused: ${verdict.refusal}.`);
                ctx.err(
                  "Check the data dir, look at what would be deleted with `elib sync --prune --dry-run`, " +
                    "and add --force only if that is really what you want.",
                );
                ctx.fail(1);
                return null;
              }
            }
            const reconciled = await reconcile(kobo, "all", { dryRun, prune });
            // Highlights come back from the Kobo (read-only there). Skipped when the Kobo could not even be listed.
            let highlights: HighlightsPullReport | undefined;
            if (options.highlights !== false && !reconciled.errors.some((e) => e.code === "listing-failed")) {
              highlights = await pullHighlights(kobo, (await readAllBooks(kobo.dataDir)).books, { dryRun });
            }
            return { reconciled, highlights };
          };
          // A real run excludes the server and other CLI runs (R1-10); a dry run writes nothing.
          const result = dryRun ? await run() : await services.processLock.hold(run);
          if (!result) return;
          const { reconciled: report, highlights } = result;
          if (options.json) {
            ctx.out(JSON.stringify(highlights ? { ...report, highlights } : report, null, 2));
          } else {
            for (const line of formatReport(report)) ctx.out(line);
            if (highlights && (highlights.items.length > 0 || highlights.errors.length > 0)) {
              for (const line of formatHighlightsReport(highlights)) ctx.out(line);
            }
          }
          if (report.errors.length > 0 || (highlights?.errors.length ?? 0) > 0) ctx.fail(1);
        },
      );
  },
};
