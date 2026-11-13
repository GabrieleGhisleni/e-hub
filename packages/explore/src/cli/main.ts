/**
 * `pnpm explore <comando>` — CLI entry. Commands are registered in ./commands.ts.
 */
import { runCli } from "./program.ts";

process.exitCode = await runCli(process.argv.slice(2));
