/**
 * `pnpm elib <command>` — CLI entry (PLAN §11). Commands live in ./commands (W3a: sync, import; W4b: text).
 * The data is the owner's, in Turso/R2, with the keys of `.env.local` (docs/hosting.md): there are no local files.
 */
import { runAsUser } from "@ehub/store";
import { mountDirectFromEnv } from "@ehub/store/hosted";
import { blobEpubRemote, setEpubRemote } from "../cache/remote.ts";
import { loadConfig } from "../config/index.ts";
import { loadLocalEnv } from "../summary/llm.ts";
import { runCli } from "./program.ts";

loadLocalEnv();
const args = process.argv.slice(2);
const needsData = !args.some((a) => a === "--help" || a === "-h" || a === "--version" || a === "-V") && args.length > 0;

if (!needsData) {
  process.exitCode = await runCli(args);
} else {
  try {
    const mount = await mountDirectFromEnv({ library: loadConfig().dataDir });
    setEpubRemote(blobEpubRemote(mount.blobs));
    process.exitCode = await runAsUser(mount.userId, () => runCli(args), { email: mount.email });
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
