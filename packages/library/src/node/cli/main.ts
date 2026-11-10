/**
 * `pnpm elib <command>` — CLI entry (PLAN §11). Commands live in ./commands (W3a: sync, import, validate; W4b: text).
 */
import { runCli } from "./program.ts";

process.exitCode = await runCli(process.argv.slice(2));
