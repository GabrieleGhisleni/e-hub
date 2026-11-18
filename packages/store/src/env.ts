import { readFileSync } from "node:fs";
import path from "node:path";

/** Loads `KEY=value` lines of `<dir>/.env.local` into `process.env` without overriding variables already set. */
export function loadEnvLocal(dir: string, env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = readFileSync(path.join(dir, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    let value = m[2]!;
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    if (env[m[1]!] === undefined) env[m[1]!] = value;
  }
}
