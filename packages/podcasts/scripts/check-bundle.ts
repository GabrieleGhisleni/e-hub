/**
 * CI guard (DESIGN.md §11): fails if the production build contains code of
 * the local-only features (the write server and the dev UI, §8.5 and §9).
 *
 * Markers come from the phase 5 report (docs/progress/phase-5.md):
 * - `e-podcasts-dev-only`: DEV_ONLY_MARKER exported by src/web/dev/slots.tsx;
 * - a chunk named `assets/slots-*.js`: the dev module's chunk name;
 * - `/api/` as the start of a string literal: the local server's routes
 *   (a bare `/api/` is not a marker: notes and conversations are bundled as
 *   data and may mention such a path);
 * - `devFeatures`: the identifier used for dev-only UI switches.
 *
 * Usage: tsx scripts/check-bundle.ts [distDir]   (distDir defaults to dist)
 * Exit: 0 clean, 1 marker found (or dist missing/empty), 2 bad usage.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEV_MARKER = "e-podcasts-dev-only";
export const DEV_CHUNK_PATTERN = /(^|\/)assets\/slots-[^/]*\.js$/;
export const API_LITERAL_PATTERN = /["'`]\/api\//;
export const DEV_IDENTIFIER = "devFeatures";

export interface Violation {
  file: string;
  reason: string;
}

/** Checks one file's path and content; returns the violations found. */
export function checkFile(relPath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const posixPath = relPath.split(path.sep).join("/");
  if (DEV_CHUNK_PATTERN.test(posixPath)) {
    violations.push({ file: posixPath, reason: "dev-only chunk (assets/slots-*.js)" });
  }
  if (content.includes(DEV_MARKER)) {
    violations.push({ file: posixPath, reason: `contains dev-only marker "${DEV_MARKER}"` });
  }
  if (API_LITERAL_PATTERN.test(content)) {
    violations.push({
      file: posixPath,
      reason: 'contains a "/api/" string literal (local server)',
    });
  }
  if (content.includes(DEV_IDENTIFIER)) {
    violations.push({ file: posixPath, reason: `contains identifier "${DEV_IDENTIFIER}"` });
  }
  return violations;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main(argv: string[]): Promise<number> {
  if (argv.length > 1) {
    console.error("usage: tsx scripts/check-bundle.ts [distDir]");
    return 2;
  }
  const distDir = path.resolve(argv[0] ?? "dist");

  const info = await stat(distDir).catch(() => undefined);
  if (!info?.isDirectory()) {
    console.error(`check:bundle: ${distDir} is not a directory (run the shell app build first)`);
    return 1;
  }
  const files = await listFiles(distDir);
  if (!files.some((f) => f.endsWith("index.html"))) {
    console.error(`check:bundle: no index.html in ${distDir}; refusing to pass an empty build`);
    return 1;
  }

  const violations: Violation[] = [];
  for (const abs of files) {
    const rel = path.relative(distDir, abs);
    const content = (await readFile(abs)).toString("latin1");
    violations.push(...checkFile(rel, content));
  }

  if (violations.length > 0) {
    console.error(`check:bundle: local-only code found in ${distDir} (DESIGN.md §11):`);
    for (const v of violations) console.error(`  - ${v.file}: ${v.reason}`);
    return 1;
  }

  console.log(`check:bundle: ok (${files.length} file(s) in ${distDir}, no local-only markers)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
