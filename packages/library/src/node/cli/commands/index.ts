/**
 * Every `elib` subcommand, in help order. To add one: create `./<name>.ts` exporting a `CliCommand` and list it here.
 */
import type { CliCommand } from "../program.ts";
import { importCommand } from "./import.ts";
import { summarizeCommand } from "./summarize.ts";
import { syncCommand } from "./sync.ts";
import { textCommand } from "./text.ts";

export const COMMANDS: readonly CliCommand[] = [
  syncCommand,
  importCommand,
  textCommand,
  summarizeCommand,
];
