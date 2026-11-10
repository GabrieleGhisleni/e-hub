/**
 * JSON file I/O (Node only): stable, readable output and atomic writes.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "./errors";

/**
 * Returns a copy of `value` whose plain-object keys are sorted alphabetically,
 * recursively. Used for free-form records (`extra`) whose key order is not
 * fixed by a schema.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

/**
 * Serialises data for the repo: 2-space indent, trailing newline. Key order is
 * the caller's (store writes schema-parsed objects, whose keys follow the
 * schema order, with `extra` sorted), so diffs stay stable and readable.
 */
export function toStableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Writes `content` atomically: a hidden temp file in the same directory
 * (`.<name>.<random>.tmp`), fsync, then rename over the target. Readers see
 * either the old or the new file, never a partial one. Creates the directory.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(tempPath, "wx");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, toStableJson(value));
}

/** Reads and parses a JSON file; `undefined` if it does not exist. */
export async function readJsonIfExists(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ValidationError(`${filePath}: invalid JSON`, [(error as Error).message]);
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
