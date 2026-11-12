/**
 * `elib summarize <id> [--lang it] [--force]` and `elib summarize --missing [--lang it]`: writes `summary.json` with the
 * LLM (docs/chat.md §4). The configuration comes from EHUB_AI_* in the monorepo's `.env.local` (see `.env.example`).
 */
import { AiConfigError, loadAiConfig } from "@ehub/chat/node";
import { createServices } from "../../services/index.ts";
import { AI_NOT_CONFIGURED_MESSAGE } from "../../services/summary.ts";
import { InvalidDataError, readAllBooks, readBookSummary, summaryPath } from "../../repo/index.ts";
import { loadLocalEnv } from "../../summary/llm.ts";
import type { SummarizeProgress } from "../../summary/index.ts";
import type { CliCommand, CliContext } from "../program.ts";

interface SummarizeOptions {
  lang: string;
  force?: boolean;
  missing?: boolean;
}

export const summarizeCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("summarize")
      .description("Write summary.json for a book (or for every book without one) with the LLM")
      .argument("[id]", "book ID (8 characters)")
      .option("--lang <code>", "output language (BCP 47)", "it")
      .option("--force", "regenerate the book text too (elib text --force)")
      .option("--missing", "every book that has no summary.json")
      .action(async (id: string | undefined, options: SummarizeOptions) => {
        await runSummarize(ctx, id, options);
      });
  },
};

async function runSummarize(
  ctx: CliContext,
  id: string | undefined,
  options: SummarizeOptions,
): Promise<void> {
  loadLocalEnv(ctx.io.env);
  try {
    loadAiConfig(ctx.io.env);
  } catch (error) {
    if (error instanceof AiConfigError) {
      ctx.err(
        `error: ${AI_NOT_CONFIGURED_MESSAGE} (${error.problems.join("; ")}). ` +
          "Vedi .env.example per le variabili EHUB_AI_*.",
      );
      ctx.fail(1);
      return;
    }
    throw error;
  }

  if (options.missing === true && id !== undefined) {
    ctx.err("error: indica un ID di libro oppure --missing, non entrambi");
    ctx.fail(1);
    return;
  }
  if (options.missing !== true && id === undefined) {
    ctx.err("error: indica un ID di libro oppure --missing");
    ctx.fail(1);
    return;
  }

  const { dataDir } = ctx.config();
  const ids = options.missing === true ? await booksWithoutSummary(dataDir) : [id!];
  if (ids.length === 0) {
    ctx.out("Tutti i libri hanno già una sintesi.");
    return;
  }

  const services = createServices(ctx.services());
  let failures = 0;
  for (const [index, bookId] of ids.entries()) {
    if (ids.length > 1) ctx.out(`Libro ${bookId} (${index + 1}/${ids.length})`);
    try {
      const result = await services.summarizeBook(
        bookId,
        { language: options.lang, force: options.force === true },
        { onProgress: (event) => printProgress(ctx, event) },
      );
      const { summary } = result;
      ctx.out(
        `Fatto: ${result.summarizedChapters} capitoli sintetizzati su ${summary.chapters.length}, ` +
          `modello ${summary.model}, ${(result.durationMs / 1000).toFixed(1)} s. ` +
          `File: ${summaryPath(dataDir, bookId)}`,
      );
    } catch (error) {
      failures += 1;
      ctx.err(`error: libro ${bookId}: ${(error as Error).message}`);
    }
  }
  if (failures > 0) ctx.fail(1);
}

function printProgress(ctx: CliContext, event: SummarizeProgress): void {
  if (event.kind === "warning") {
    ctx.err(`  avviso: ${event.step}: ${event.message}`);
    return;
  }
  ctx.out(progressLine(event));
}

/** One progress line for the terminal (a warning is not a line of this kind: see `printProgress`). */
export function progressLine(event: Exclude<SummarizeProgress, { kind: "warning" }>): string {
  if (event.kind === "book") return "  Sintesi del libro… ok";
  const width = String(event.total).length;
  const label =
    event.status === "summarized"
      ? "ok"
      : event.reason === "front-back-matter"
        ? "saltato (parte accessoria)"
        : "saltato (meno di 150 parole)";
  return `  ${String(event.done).padStart(width)}/${event.total} Capitolo ${event.chapter.n} "${event.chapter.title}"… ${label}`;
}

/** IDs of the books without a readable summary.json (an invalid one counts as missing: it gets regenerated). */
async function booksWithoutSummary(dataDir: string): Promise<string[]> {
  const { books } = await readAllBooks(dataDir);
  const missing: string[] = [];
  for (const book of books) {
    try {
      if ((await readBookSummary(dataDir, book.id)) === null) missing.push(book.id);
    } catch (error) {
      if (!(error instanceof InvalidDataError)) throw error;
      missing.push(book.id);
    }
  }
  return missing;
}
