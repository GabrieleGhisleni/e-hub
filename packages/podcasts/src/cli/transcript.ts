/**
 * `pnpm transcript export <slug> [--out <file>]` — the local transcript as
 * compact markdown for an agent (DESIGN.md §4.4). Read-only; stdout by default.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { CoreError, EXIT_CODES, exitCodeFor } from "../core/errors";
import { assertSlug } from "../core/paths";
import { exportTranscriptMarkdown } from "../core/transcript-export";

// `| head` closes the pipe early: not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const USAGE = "Usage: pnpm transcript export <slug> [--out <file>]";

async function main(argv: string[]): Promise<number> {
  let slug: string;
  let out: string | undefined;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { out: { type: "string" } },
    });
    const [command, ...rest] = positionals;
    if (command !== "export" || rest.length !== 1) throw new Error("expected: export <slug>");
    slug = rest[0]!;
    out = values.out;
  } catch (error) {
    console.error(`error: ${(error as Error).message}\n${USAGE}`);
    return EXIT_CODES.usage;
  }
  try {
    assertSlug(slug);
    const markdown = await exportTranscriptMarkdown(slug);
    if (out) {
      await writeFile(out, markdown, "utf8");
      console.error(`Wrote ${out}`);
    } else {
      process.stdout.write(markdown);
    }
    return EXIT_CODES.ok;
  } catch (error) {
    console.error(
      error instanceof CoreError ? `error (${error.code}): ${error.describe()}` : error,
    );
    return exitCodeFor(error);
  }
}

process.exitCode = await main(process.argv.slice(2));
