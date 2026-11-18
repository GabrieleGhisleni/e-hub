import { readTextIfExists, writeFileAtomic } from "@ehub/store";

// Reads and writes go through @ehub/store: plain files, or Turso/R2 when the data dir is mounted (docs/hosting.md).
export { readTextIfExists, writeFileAtomic };

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** 2-space JSON with a trailing newline: the one format of every file under data/. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
