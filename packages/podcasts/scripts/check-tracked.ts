/**
 * CI guard (DESIGN.md §2.4, §11): fails if git tracks any local-only file.
 *
 * Local data never goes to git: transcripts, downloaded audio and caches.
 * .gitignore is not enough on its own (a file can be force-added), so this
 * checks the index itself.
 *
 * Usage: tsx scripts/check-tracked.ts [repoDir]   (repoDir defaults to cwd)
 * Exit: 0 clean, 1 forbidden tracked files (listed), 2 git failed.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORBIDDEN_PREFIXES = ["data/transcripts/", "data/audio/", "data/cache/"] as const;

/** Tracked paths (repo-relative, POSIX separators) under a forbidden prefix. */
export function findForbidden(trackedPaths: readonly string[]): string[] {
  return trackedPaths.filter((file) => FORBIDDEN_PREFIXES.some((p) => file.startsWith(p)));
}

function listTracked(repoDir: string): string[] {
  const out = execFileSync("git", ["-C", repoDir, "ls-files", "-z", "--full-name"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\0").filter(Boolean);
}

function main(argv: string[]): number {
  const repoDir = path.resolve(argv[0] ?? process.cwd());
  let tracked: string[];
  try {
    tracked = listTracked(repoDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`check:tracked: git ls-files failed in ${repoDir}\n${reason}`);
    return 2;
  }

  const offending = findForbidden(tracked);
  if (offending.length > 0) {
    console.error(
      `check:tracked: ${offending.length} local-only file(s) are tracked by git ` +
        `(must never be in the repo, DESIGN.md §2.4):`,
    );
    for (const file of offending) console.error(`  - ${file}`);
    console.error("Remove them from the index with: git rm --cached <file>");
    return 1;
  }

  console.log(
    `check:tracked: ok (${tracked.length} tracked file(s) checked, none under ${FORBIDDEN_PREFIXES.join(", ")})`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
