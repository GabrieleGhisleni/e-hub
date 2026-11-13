/**
 * Explorations on disk (Node only): `<dataDir>/<id>.json`, one file per exploration, JSON with two spaces.
 * Writes are atomic (temp file + rename) and serialised per file, so two quick edits never lose each other.
 *
 * This module does not import the library: the Vite build guard (vite.ts) loads it from the web app's config.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { Exploration, ExplorationId, formatIssues } from "../schema.ts";
import type { Exploration as ExplorationT } from "../schema.ts";

export const DATA_DIR_ENV = "EHUB_EXPLORE_DATA_DIR";
const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../data", import.meta.url));

export function exploreDataDir(): string {
  return path.resolve(process.env[DATA_DIR_ENV] || DEFAULT_DATA_DIR);
}

export type ExploreErrorCode =
  | "not-found"
  | "already-exists"
  | "invalid-file"
  | "invalid-input"
  | "conflict";

/** An error the user can read: the message is in Italian, `details` lists the individual problems. */
export class ExploreError extends Error {
  // Plain fields, no parameter properties: this file is also loaded by Node's type stripping (vite.config).
  readonly code: ExploreErrorCode;
  readonly details: string[];
  constructor(code: ExploreErrorCode, message: string, details: string[] = []) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function explorationFile(id: string, dataDir = exploreDataDir()): string {
  // Validated before it reaches the file system.
  const parsed = ExplorationId.safeParse(id);
  if (!parsed.success) throw new ExploreError("invalid-input", `ID non valido: ${id}`);
  return path.join(dataDir, `${parsed.data}.json`);
}

/** Reads and validates one file. Throws `invalid-file` with the reasons when it does not match the schema. */
export async function readExplorationFile(file: string): Promise<ExplorationT | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const name = path.basename(file);
  let parsed: ExplorationT;
  try {
    parsed = Exploration.parse(JSON.parse(text));
  } catch (error) {
    const details = error instanceof ZodError ? formatIssues(error) : [(error as Error).message];
    throw new ExploreError("invalid-file", `File di esplorazione non valido: ${name}`, details);
  }
  if (`${parsed.id}.json` !== name) {
    throw new ExploreError("invalid-file", `Il nome del file non corrisponde all'ID: ${name}`, [
      `id: ${parsed.id}`,
    ]);
  }
  return parsed;
}

export async function writeExplorationFile(file: string, content: ExplorationT): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(Exploration.parse(content), null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call for the same key has settled. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

/** Every exploration file in the data dir, sorted by ID. Invalid files are reported, never skipped. */
export async function listExplorationFiles(dataDir = exploreDataDir()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort()
    .map((name) => path.join(dataDir, name));
}

/** Newest first. Throws on the first invalid file (use `checkExplorations` to list all of them). */
export async function listExplorations(dataDir = exploreDataDir()): Promise<ExplorationT[]> {
  const found: ExplorationT[] = [];
  for (const file of await listExplorationFiles(dataDir)) {
    const exploration = await readExplorationFile(file);
    if (exploration) found.push(exploration);
  }
  return found.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export interface ExplorationFileProblem {
  file: string;
  message: string;
  details: string[];
}

/** Validates every file and returns the problems (empty = all good). Used by `explore validate` and the build. */
export async function checkExplorations(
  dataDir = exploreDataDir(),
): Promise<{ valid: number; problems: ExplorationFileProblem[] }> {
  const problems: ExplorationFileProblem[] = [];
  let valid = 0;
  for (const file of await listExplorationFiles(dataDir)) {
    try {
      if (await readExplorationFile(file)) valid += 1;
    } catch (error) {
      if (error instanceof ExploreError) {
        problems.push({ file, message: error.message, details: error.details });
      } else {
        throw error;
      }
    }
  }
  return { valid, problems };
}
