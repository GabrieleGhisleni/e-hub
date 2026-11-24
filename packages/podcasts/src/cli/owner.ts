/**
 * The CLIs work on the owner's data in Turso/R2 with the keys of `.env.local` (docs/hosting.md): there are no local data
 * files. `runOnOwnerData` mounts the podcasts data dir on the database and runs `fn` as the owner (`EHUB_OWNER_EMAIL`).
 * The one exception is for the tests, which run the CLI on a temp folder: with `E_PODCASTS_DATA_DIR` set it is left on files.
 */
import { fileURLToPath } from "node:url";
import { loadEnvLocal, runAsUser } from "@ehub/store";
import { mountDirectFromEnv } from "@ehub/store/hosted";
import { EXIT_CODES } from "../core/errors";
import { dataDir } from "../core/paths";

export async function runOnOwnerData(fn: () => Promise<number>): Promise<number> {
  if (process.env.E_PODCASTS_DATA_DIR) return fn();
  loadEnvLocal(fileURLToPath(new URL("../../../../", import.meta.url)));
  try {
    const mount = await mountDirectFromEnv({ podcasts: dataDir() });
    return await runAsUser(mount.userId, fn, { email: mount.email });
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return EXIT_CODES.unexpected;
  }
}
