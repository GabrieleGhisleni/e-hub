/**
 * `pnpm episode <command>` — the CLI write path over core (DESIGN.md §5).
 *
 *   pnpm episode save <slug> --input <file|-> [--expected-updated-at <ts>] [--json]
 *   pnpm episode add <url> [--added-at <date>] [--feed <url> | --no-feed] [--yes] [--json]
 *       (implemented in episode-add.ts)
 *
 * Exit codes: see EXIT_CODES in src/core/errors.ts (0 ok, 1 unexpected,
 * 2 usage, 3 validation, 4 not found, 5 conflict, 6 transcript guard,
 * 7 duplicate, 8 already exists).
 */
import { runOnOwnerData } from "./owner";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { CoreError, EXIT_CODES, ValidationError, exitCodeFor } from "../core/errors";
import { saveEpisode, type SaveEpisodeResult } from "../core/save";
import { ADD_USAGE, runAdd as runAddCommand, terminalAddIo } from "./episode-add";

const USAGE = `Usage:
  pnpm episode save <slug> --input <file|-> [--expected-updated-at <ts>] [--json]
      Apply summary/notes/tags/guests/guestDescriptions/conversations from a JSON file (- = stdin).
      Present fields overwrite, absent ones stay unchanged; conversations are appended (deduplicated).
${ADD_USAGE}`;

class UsageError extends Error {}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(source: string): Promise<unknown> {
  let text: string;
  try {
    text = source === "-" ? await readStdin() : await readFile(source, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read input '${source}': ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ValidationError(`input '${source}' is not valid JSON`, [(error as Error).message]);
  }
}

function describeSave(slug: string, result: SaveEpisodeResult): string {
  const { added, skipped, excerptsRemoved } = result.conversations;
  const lines = [result.written ? `Saved ${slug}` : `No changes for ${slug}`];
  lines.push(
    `  fields changed: ${result.changedFields.length ? result.changedFields.join(", ") : "none"}`,
  );
  if (added || skipped)
    lines.push(`  conversations: ${added} added, ${skipped} skipped (already stored)`);
  if (excerptsRemoved) lines.push(`  transcript excerpts removed: ${excerptsRemoved}`);
  if (!result.transcriptChecked)
    lines.push("  no local transcript: excerpt check skipped (size limit applied)");
  lines.push(`  updatedAt: ${result.episode.updatedAt}`);
  return lines.join("\n");
}

async function runSave(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      input: { type: "string", short: "i" },
      "expected-updated-at": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [slug, ...rest] = positionals;
  if (!slug || rest.length > 0) throw new UsageError("save needs exactly one <slug>");
  if (!values.input) throw new UsageError("save needs --input <file|->");

  const input = await readInput(values.input);
  const result = await saveEpisode(slug, input, {
    expectedUpdatedAt: values["expected-updated-at"],
  });
  if (values.json) {
    console.log(
      JSON.stringify({
        slug,
        written: result.written,
        updatedAt: result.episode.updatedAt,
        changedFields: result.changedFields,
        conversations: result.conversations,
        transcriptChecked: result.transcriptChecked,
      }),
    );
  } else {
    console.log(describeSave(slug, result));
  }
  return EXIT_CODES.ok;
}

// `add`: ingest lives in src/core/ingest/, the command in ./episode-add.ts.
async function runAdd(args: string[]): Promise<number> {
  return runAddCommand(args, terminalAddIo());
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  save: runSave,
  add: runAdd,
};

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? EXIT_CODES.ok : EXIT_CODES.usage;
  }
  const run = COMMANDS[command];
  if (!run) {
    console.error(`unknown command '${command}'\n\n${USAGE}`);
    return EXIT_CODES.usage;
  }
  try {
    return await run(args);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`error: ${(error as Error).message}\n\n${USAGE}`);
      return EXIT_CODES.usage;
    }
    if (error instanceof CoreError) {
      console.error(`error (${error.code}): ${error.describe()}`);
      return exitCodeFor(error);
    }
    console.error(error);
    return EXIT_CODES.unexpected;
  }
}

process.exitCode = await runOnOwnerData(() => main(process.argv.slice(2)));
