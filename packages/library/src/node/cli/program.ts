/**
 * `elib` program: commander setup, the context handed to every command, and `runCli` (testable in-process).
 *
 * Adding a command (W4b `elib text <id>`): write `src/node/cli/commands/<name>.ts` exporting a `CliCommand`, then add it
 * to the `COMMANDS` array in `src/node/cli/commands/index.ts` (one import + one array entry).
 */
import { Command, CommanderError } from "commander";
import { type LoadedConfig, ConfigError, loadConfig } from "../config/index.ts";
import {
  type Logger,
  type ServiceContext,
  ServiceError,
  createServiceContext,
} from "../services/index.ts";
import { COMMANDS } from "./commands/index.ts";

/** Where the CLI writes and what it runs with (tests pass their own). */
export interface CliIO {
  /** Raw writes (include the newline). */
  stdout(text: string): void;
  stderr(text: string): void;
  /** Env for config loading (`ELIB_CONFIG`…) and for rclone/kepubify (`RCLONE_CONFIG`). */
  env: NodeJS.ProcessEnv;
  /** Open Library fetch (default global fetch). */
  fetch?: typeof fetch;
}

export interface CliContext {
  readonly io: CliIO;
  /** One line to stdout / stderr. */
  out(line?: string): void;
  err(line?: string): void;
  /** Loaded once, on first use. */
  config(): LoadedConfig;
  /** Service context (Drive context included), built once on first use. */
  services(): ServiceContext;
  /** Raises the process exit code (the highest value wins). */
  fail(code?: number): void;
}

/** A subcommand: adds itself (options, action) to the program. */
export interface CliCommand {
  register(program: Command, ctx: CliContext): void;
}

export function processIo(): CliIO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
  };
}

export function createCliContext(io: CliIO, onFail: (code: number) => void): CliContext {
  let config: LoadedConfig | undefined;
  let services: ServiceContext | undefined;
  const out = (line = "") => io.stdout(`${line}\n`);
  const err = (line = "") => io.stderr(`${line}\n`);
  const logger: Logger = {
    info: () => undefined,
    warn: (message) => err(`warning: ${message}`),
    error: (message, error) =>
      err(`error: ${message}${error ? `: ${(error as Error).message ?? String(error)}` : ""}`),
  };
  const ctx: CliContext = {
    io,
    out,
    err,
    config: () => (config ??= loadConfig({ env: io.env })),
    services: () =>
      (services ??= createServiceContext(ctx.config(), {
        env: io.env,
        logger,
        ...(io.fetch ? { fetch: io.fetch } : {}),
      })),
    fail: (code = 1) => onFail(code),
  };
  return ctx;
}

export function createProgram(ctx: CliContext): Command {
  const program = new Command()
    .name("elib")
    .description("e-library: gestione locale della libreria EPUB (repo → Drive)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.io.stdout(text),
      writeErr: (text) => ctx.io.stderr(text),
    });
  for (const command of COMMANDS) command.register(program, ctx);
  return program;
}

/** Runs the CLI with `argv` (without node + script); resolves to the exit code. */
export async function runCli(argv: readonly string[], io: CliIO = processIo()): Promise<number> {
  let exitCode = 0;
  const ctx = createCliContext(io, (code) => {
    exitCode = Math.max(exitCode, code);
  });
  const program = createProgram(ctx);
  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    if (error instanceof ServiceError || error instanceof ConfigError) {
      ctx.err(`error: ${error.message}`);
      return 1;
    }
    ctx.err(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  }
  return exitCode;
}
