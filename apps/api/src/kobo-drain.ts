/**
 * Run by the systemd timer every 5 minutes (deploy/pi/ehub-kobo-sync.timer): if the Kobo answers, empties the queue
 * of the Kobo's owner (`KOBO_OWNER_EMAIL`) with `reconcile`. The Kobo is off most of the time, so "asleep" is a normal,
 * quiet outcome (exit 0). Never prunes.
 */
import { LockBusyError, createServiceContext, drainWithDiscovery } from "@ehub/library/services";
import { runAsUser } from "@ehub/store";
import { boot } from "./boot.ts";

process.env.ELIB_KOBO_QUEUE = "1";
const { env, config, docs } = await boot();
if (env.KOBO_OWNER_EMAIL === "") {
  console.log("kobo queue: nessun proprietario del Kobo (KOBO_OWNER_EMAIL)");
  process.exit(0);
}
const owner = await docs.users.findByEmail(env.KOBO_OWNER_EMAIL);
if (!owner || owner.id.startsWith("email:")) {
  // Not logged in yet: the data still belongs to the placeholder, which has no folder on the Pi.
  console.log("kobo queue: il proprietario non ha ancora fatto login");
  process.exit(0);
}
const ctx = createServiceContext(config, { queue: true });

try {
  const result = await runAsUser(owner.id, () => ctx.lock.runExclusive(() => drainWithDiscovery(ctx)), {
    email: owner.email,
  });
  console.log(`kobo queue: ${result.status} (${result.pending} in coda)`);
  if (result.report && result.report.errors.length > 0) {
    for (const e of result.report.errors) console.error(`  ${e.code}: ${e.message}`);
    process.exit(1);
  }
} catch (error) {
  // Another process (the API, the CLI) is syncing: the next tick will try again.
  if (error instanceof LockBusyError) console.log("kobo queue: busy");
  else throw error;
}
