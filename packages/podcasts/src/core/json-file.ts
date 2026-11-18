/**
 * JSON file I/O (Node only): stable, readable output and atomic writes.
 */
import { readTextIfExists, writeFileAtomic as storeWrite } from "@ehub/store";
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
 * Writes `content` atomically (through @ehub/store: temp file + rename on disk, one upsert when the data dir is
 * mounted on Supabase). Creates the directory.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  await storeWrite(filePath, content);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, toStableJson(value));
}

/** Reads and parses a JSON file; `undefined` if it does not exist. */
export async function readJsonIfExists(filePath: string): Promise<unknown> {
  const text = await readTextIfExists(filePath);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ValidationError(`${filePath}: invalid JSON`, [(error as Error).message]);
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
