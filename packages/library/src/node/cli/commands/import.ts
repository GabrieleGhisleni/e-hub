/**
 * `elib import <folder> [--dry-run] [--limit n] [--openlibrary] [--json]` (PLAN §11, §12 Fase 2 and 5).
 * The dry run extracts metadata and checks duplicates without writing anything: the tool to test extraction on real
 * EPUBs. A real run creates every new book in "Da smistare" through the same path as the upload form.
 */
import path from "node:path";
import { InvalidArgumentError } from "commander";
import {
  type ImportItem,
  type ImportResult,
  UNKNOWN_AUTHOR,
  importFolder,
} from "../../services/index.ts";
import { formatTable } from "../format.ts";
import type { CliCommand, CliContext } from "../program.ts";

function parseLimit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
}

export const importCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("import")
      .description(
        'Import every *.epub under <folder> into "Da smistare" (to-read, EPUB cover); *.kepub.epub are skipped',
      )
      .argument("<folder>", "folder to scan recursively")
      .option("--dry-run", "only extract metadata and check duplicates (writes nothing)")
      .option("--limit <n>", "process at most n EPUBs", parseLimit)
      .option(
        "--openlibrary",
        "look up Open Library (throttled: 100 requests / 5 min) for EPUBs without a cover",
      )
      .option("--json", "print the result as JSON")
      .action(
        async (
          folder: string,
          options: { dryRun?: boolean; limit?: number; openlibrary?: boolean; json?: boolean },
        ) => {
          const root = path.resolve(folder);
          const dryRun = options.dryRun === true;
          const rel = (file: string) => path.relative(root, file) || path.basename(file);
          const services = ctx.services();
          const doImport = () =>
            importFolder(services, root, {
              dryRun,
              ...(options.limit !== undefined ? { limit: options.limit } : {}),
              openLibrary: options.openlibrary === true,
              onItem: (item, index, total) => {
                if (options.json || dryRun) return;
                ctx.err(`[${index + 1}/${total}] ${itemLine(item, rel)}`);
              },
            });
          // A real run excludes the server and other CLI runs for its whole duration (R1-10).
          const result = dryRun ? await doImport() : await services.processLock.hold(doImport);
          if (options.json) ctx.out(JSON.stringify(result, null, 2));
          else printResult(ctx, result, rel);
          if (result.errors.length > 0 || result.items.some((i) => i.status === "failed")) {
            ctx.fail(1);
          }
        },
      );
  },
};

function itemLine(item: ImportItem, rel: (file: string) => string): string {
  const name = rel(item.file);
  switch (item.status) {
    case "imported":
      return `imported ${item.bookId}: ${item.title} — ${item.authors.join(", ") || UNKNOWN_AUTHOR} (cover: ${item.cover})`;
    case "duplicate":
      return `skipped ${name}: ${duplicateText(item, rel)}`;
    case "invalid":
      return `invalid ${name}: ${item.error}`;
    case "failed":
      return `FAILED ${name}: ${item.error}`;
    default:
      return `${item.status} ${name}`;
  }
}

function duplicateText(item: ImportItem, rel: (file: string) => string): string {
  return item.duplicates
    .filter((d) => d.kind === "md5" || d.kind === "batch")
    .map((d) =>
      d.kind === "md5"
        ? `same file already on Drive: ${d.path}`
        : d.kind === "batch"
          ? `same file as ${rel(d.file)}`
          : "",
    )
    .join("; ");
}

function printResult(ctx: CliContext, result: ImportResult, rel: (file: string) => string): void {
  const { items } = result;
  if (result.dryRun && items.length > 0) {
    const yes = (b: boolean) => (b ? "yes" : "-");
    ctx.out(
      formatTable(
        ["#", "file", "title", "author", "isbn", "lang", "cover", "subj", "desc", "status"],
        items.map((item, i) => [
          String(i + 1),
          rel(item.file),
          item.title ?? "",
          item.authors[0] ?? "-",
          item.isbn ?? "-",
          item.language ?? "-",
          item.status === "invalid" ? "-" : (item.cover ?? "-"),
          String(item.subjects),
          yes(item.hasDescription),
          item.status === "ready" ? "new" : item.status,
        ]),
        36,
      ).join("\n"),
    );
    ctx.out();
  }

  const notes = items.filter(
    (i) => i.status !== "imported" || i.warnings.length > 0 || i.duplicates.length > 0,
  );
  if (notes.length > 0) {
    ctx.out("Details:");
    for (const item of notes) {
      const lines: string[] = [];
      if (item.status === "invalid" || item.status === "failed") lines.push(`error: ${item.error}`);
      if (item.status === "duplicate") lines.push(`skipped: ${duplicateText(item, rel)}`);
      for (const d of item.duplicates) {
        if (d.kind === "title-author") {
          lines.push(`warning: same title/author as book ${d.bookId} (${d.title})`);
        }
      }
      if (item.openLibrary) {
        lines.push(
          `Open Library: cover ${item.openLibrary.coverId} by ${item.openLibrary.matchedBy}${item.openLibrary.needsConfirmation ? " (needs confirmation: not used, change it from the UI)" : ""}`,
        );
      }
      for (const w of item.warnings) lines.push(`note: ${w}`);
      if (item.report && item.report.errors.length > 0) {
        for (const e of item.report.errors) lines.push(`drive error: ${e.code}: ${e.message}`);
      }
      if (lines.length === 0) continue;
      ctx.out(`  ${rel(item.file)}`);
      for (const line of lines) ctx.out(`    ${line}`);
    }
    ctx.out();
  }

  const count = (status: ImportItem["status"]) => items.filter((i) => i.status === status).length;
  const valid = items.filter((i) => i.status !== "invalid");
  const missing = (pred: (i: ImportItem) => boolean) => valid.filter(pred).length;
  ctx.out(
    `Found ${result.scanned} EPUB(s)` +
      (result.notProcessed > 0 ? `, processed ${items.length} (--limit)` : "") +
      (result.skippedKepubs.length > 0
        ? `; skipped ${result.skippedKepubs.length} *.kepub.epub (import the original EPUB instead)`
        : ""),
  );
  ctx.out(
    `Missing among ${valid.length} readable: author ${missing((i) => i.authors.length === 0)}, ` +
      `ISBN ${missing((i) => !i.isbn)}, cover ${missing((i) => !i.hasEpubCover)}, ` +
      `language ${missing((i) => !i.language)}, description ${missing((i) => !i.hasDescription)}, ` +
      `subjects ${missing((i) => i.subjects === 0)}`,
  );
  ctx.out(
    result.dryRun
      ? `Dry run: ${count("ready")} would be imported, ${count("duplicate")} duplicate(s) skipped, ${count("invalid")} invalid. Nothing was written.`
      : `Imported ${count("imported")}, ${count("duplicate")} duplicate(s) skipped, ${count("invalid")} invalid, ${count("failed")} failed.`,
  );
  for (const w of result.warnings) ctx.err(`warning: ${w}`);
  for (const e of result.errors) ctx.err(`error: ${e}`);
}
