/**
 * `elib text <id> [--force]`: EPUB → Markdown, one file per chapter, in the local cache (never the repo).
 * PLAN §11, Fase 6; used by the study skill in `.claude/skills/study/`.
 */
import { extractBookText } from "../../text/index.ts";
import type { CliCommand } from "../program.ts";

export const textCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("text")
      .description(
        "Extract a book's text as Markdown, one file per chapter (local cache, outside the repo)",
      )
      .argument("<id>", "book ID (8 characters)")
      .option("--force", "regenerate even if the text already exists")
      .action(async (id: string, options: { force?: boolean }) => {
        try {
          const result = await extractBookText(ctx.services().drive, id, {
            force: options.force === true,
          });
          const { manifest } = result;
          ctx.out(
            result.skipped
              ? `Text already extracted (use --force to regenerate): ${result.outputDir}`
              : `Text extracted${result.downloaded ? " (EPUB downloaded from Drive)" : ""}: ${result.outputDir}`,
          );
          ctx.out(`${manifest.title} (${manifest.authors.join(", ")})`);
          for (const c of manifest.chapters) {
            ctx.out(`  ${String(c.n).padStart(2)}. ${c.title} [${c.file}] ${c.words} words`);
          }
        } catch (error) {
          ctx.err(`error: ${(error as Error).message}`);
          ctx.fail(1);
        }
      });
  },
};
