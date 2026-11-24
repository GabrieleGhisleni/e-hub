/**
 * `pnpm tags [--json]` — existing tags with episode counts, most used first.
 * Read-only. Plain output: one `tag<TAB>count` per line.
 */
import { runOnOwnerData } from "./owner";
import { parseArgs } from "node:util";
import { CoreError, EXIT_CODES, exitCodeFor } from "../core/errors";
import { listEpisodes } from "../core/store";
import { countTags } from "../core/tags";

async function main(argv: string[]): Promise<number> {
  let json = false;
  try {
    json =
      parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } }).values
        .json ?? false;
  } catch (error) {
    console.error(`error: ${(error as Error).message}\nUsage: pnpm tags [--json]`);
    return EXIT_CODES.usage;
  }
  try {
    const tags = countTags(await listEpisodes());
    if (json) console.log(JSON.stringify(tags));
    else for (const { tag, count } of tags) console.log(`${tag}\t${count}`);
    return EXIT_CODES.ok;
  } catch (error) {
    console.error(
      error instanceof CoreError ? `error (${error.code}): ${error.describe()}` : error,
    );
    return exitCodeFor(error);
  }
}

process.exitCode = await runOnOwnerData(() => main(process.argv.slice(2)));
