/**
 * `pnpm validate:data` — checks data/ (schemas, topic references, allowed files, suspicious keys).
 * Exit code 1 when there are errors; warnings do not fail.
 */
import path from "node:path";
import { loadConfig } from "../config/index.ts";
import { validateData } from "./validate.ts";

async function main(): Promise<number> {
  const { dataDir } = loadConfig();
  const { errors, warnings } = await validateData(dataDir);
  const where = (p?: string) => (p ? `${path.join(path.basename(dataDir), p)}: ` : "");
  for (const w of warnings) console.warn(`warning: ${where(w.path)}${w.message}`);
  for (const e of errors) console.error(`error: ${where(e.path)}${e.message}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  return errors.length === 0 ? 0 : 1;
}

process.exitCode = await main();
