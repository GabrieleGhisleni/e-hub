/**
 * `pnpm explore <comando>` — CLI entry. Commands are registered in ./commands.ts.
 * The explorations, the notes and the library catalog are the owner's, in Turso/R2 (docs/hosting.md), with the keys of
 * `.env.local`.
 */
import { fileURLToPath } from "node:url";
import { loadConfig } from "@ehub/library/config";
import { blobEpubRemote, setEpubRemote } from "@ehub/library/epub-remote";
import { notesDataDir } from "@ehub/notes/node";
import { loadEnvLocal, runAsUser } from "@ehub/store";
import { mountDirectFromEnv } from "@ehub/store/hosted";
import { exploreDataDir } from "../node/store.ts";
import { runCli } from "./program.ts";

loadEnvLocal(fileURLToPath(new URL("../../../..", import.meta.url)));
try {
  const mount = await mountDirectFromEnv({
    explore: exploreDataDir(),
    notes: notesDataDir(),
    library: loadConfig().dataDir,
  });
  setEpubRemote(blobEpubRemote(mount.blobs));
  process.exitCode = await runAsUser(mount.userId, () => runCli(process.argv.slice(2)), { email: mount.email });
} catch (error) {
  console.error(`Archivio non disponibile: ${(error as Error).message}`);
  process.exitCode = 1;
}
