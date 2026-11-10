import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Topic } from "../../src/shared/schema.ts";
import { makeTempDir } from "./tmp.ts";

/** `test/fixtures/topics.json`: unsorted, narrativa, saggistica, filosofia, scienze-sociali ("Scienze: società/politica"). */
export const FIXTURE_TOPICS_PATH = fileURLToPath(
  new URL("../fixtures/topics.json", import.meta.url),
);

export interface TempDataDir {
  /** Use as the `dataDir` argument of the repo store (contains topics.json and books/). */
  dataDir: string;
  /** Parent temp dir (free for siblings such as a cache dir). */
  root: string;
  cleanup(): Promise<void>;
}

/**
 * Temp `data/` dir with `books/` and a copy of the fixture topics.json (or `topics` if given,
 * or no topics.json at all with `topics: false`).
 */
export async function makeTempDataDir(
  options: { topics?: Topic[] | false } = {},
): Promise<TempDataDir> {
  const tmp = await makeTempDir("elib-data-");
  const dataDir = path.join(tmp.dir, "data");
  await mkdir(path.join(dataDir, "books"), { recursive: true });
  const topicsFile = path.join(dataDir, "topics.json");
  if (options.topics === undefined) {
    await copyFile(FIXTURE_TOPICS_PATH, topicsFile);
  } else if (options.topics !== false) {
    await writeFile(topicsFile, `${JSON.stringify(options.topics, null, 2)}\n`);
  }
  return { dataDir, root: tmp.dir, cleanup: tmp.cleanup };
}
