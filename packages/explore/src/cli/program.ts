/**
 * `explore` program: the CLI io, `runCli` (testable in-process) and the mapping from errors to exit codes:
 * 0 ok, 1 error (an exploration could not be changed or read), 2 wrong usage (unknown command or option, missing
 * or conflicting option, malformed value).
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command, CommanderError } from "commander";
import { ExploreError, type LibraryDeps } from "../node/index.ts";
import { registerCommands } from "./commands.ts";

/** Where the CLI reads and writes. Relative paths resolve against `cwd`. */
export interface CliIO {
  /** Raw writes (include the newline). */
  stdout(text: string): void;
  stderr(text: string): void;
  /** Working directory of the user (`INIT_CWD` when run through pnpm from the repo root). */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Reads all of stdin (for `--text-file -`). */
  readStdin(): Promise<string>;
}

export function processIo(): CliIO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env: process.env,
    readStdin: () => readAll(process.stdin),
  };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/** Wrong usage: exit code 2. */
export class UsageError extends Error {}

/** Ends the run with a code, without another message (the command already printed its report). */
export class ExitWith extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

export interface CliContext {
  readonly io: CliIO;
  /** Library dependencies (tests pass fakes; the defaults are the library facade). */
  readonly deps: Partial<LibraryDeps>;
  out(line?: string): void;
  err(line?: string): void;
  /** Absolute path of a path given by the user. */
  resolve(file: string): string;
  /** Text from `--text`, `--text-file` (`-` = stdin). */
  readText(file: string): Promise<string>;
}

export function createContext(io: CliIO, deps: Partial<LibraryDeps>): CliContext {
  return {
    io,
    deps,
    out: (line = "") => io.stdout(`${line}\n`),
    err: (line = "") => io.stderr(`${line}\n`),
    resolve: (file) => path.resolve(io.cwd, file),
    readText: async (file) => {
      if (file === "-") return io.readStdin();
      const full = path.resolve(io.cwd, file);
      try {
        return await readFile(full, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new ExploreError("invalid-input", `File non trovato: ${full}`);
        }
        throw error;
      }
    },
  };
}

export function createProgram(ctx: CliContext): Command {
  const program = new Command()
    .name("explore")
    .description("Esplorazioni: una domanda posta a uno o più libri (fonti, verdetti, note, diario)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.io.stdout(text),
      writeErr: (text) => ctx.io.stderr(text),
    });
  registerCommands(program, ctx);
  return program;
}

/** Runs the CLI with `argv` (without node and the script); resolves to the exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIO = processIo(),
  deps: Partial<LibraryDeps> = {},
): Promise<number> {
  const ctx = createContext(io, deps);
  const program = createProgram(ctx);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof ExitWith) return error.code;
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" || error.code === "commander.version"
        ? 0
        : 2;
    }
    if (error instanceof UsageError) {
      ctx.err(`errore: ${error.message}`);
      ctx.err(`Usa "explore --help" per l'elenco dei comandi.`);
      return 2;
    }
    if (error instanceof ExploreError) {
      ctx.err(`errore: ${error.message}`);
      for (const detail of error.details) ctx.err(`  - ${detail}`);
      return 1;
    }
    ctx.err(`errore: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
