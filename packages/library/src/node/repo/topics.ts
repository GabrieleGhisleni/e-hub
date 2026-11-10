import { readFile } from "node:fs/promises";
import { type Topic, TopicsFileSchema } from "../../shared/schema.ts";
import { InvalidDataError } from "./errors.ts";
import { formatJson, writeFileAtomic } from "./fs.ts";
import { topicsPath } from "./paths.ts";

/** Reads and validates `data/topics.json`. Throws `InvalidDataError` when invalid. */
export async function readTopics(dataDir: string): Promise<Topic[]> {
  const file = topicsPath(dataDir);
  const text = await readFile(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidDataError(file, `invalid JSON: ${(error as Error).message}`, [], error);
  }
  const parsed = TopicsFileSchema.safeParse(raw);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  return parsed.data;
}

/** `{id, label}` first, then unknown keys in their original order. */
export function serializeTopics(topics: readonly Topic[]): string {
  return formatJson(
    topics.map((topic) => {
      const { id, label, ...rest } = topic;
      return { id, label, ...rest };
    }),
  );
}

/** Validates (unique IDs, `unsorted` present, distinct folder names) and writes atomically. */
export async function writeTopics(dataDir: string, topics: readonly Topic[]): Promise<void> {
  const file = topicsPath(dataDir);
  const parsed = TopicsFileSchema.safeParse(topics);
  if (!parsed.success) throw InvalidDataError.fromZod(file, parsed.error);
  await writeFileAtomic(file, serializeTopics(topics));
}
