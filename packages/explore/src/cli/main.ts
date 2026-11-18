/**
 * `pnpm explore <comando>` — CLI entry. Commands are registered in ./commands.ts.
 * With EHUB_API_URL and EHUB_API_TOKEN set, the explorations, the notes and the library catalog are those of the
 * hosted API (docs/hosting.md); otherwise the local files.
 */
import { loadConfig } from "@ehub/library/config";
import { notesDataDir } from "@ehub/notes/node";
import { mountRemoteFromEnv } from "@ehub/store";
import { exploreDataDir } from "../node/store.ts";
import { runCli } from "./program.ts";

try {
  mountRemoteFromEnv({
    explore: exploreDataDir(),
    notes: notesDataDir(),
    library: loadConfig().dataDir,
  });
} catch (error) {
  console.error(`Archivio remoto non disponibile: ${(error as Error).message}`);
  process.exit(1);
}

process.exitCode = await runCli(process.argv.slice(2));
