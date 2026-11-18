/**
 * Run by the systemd timer every 5 minutes (deploy/pi/ehub-kobo-sync.timer): if the Kobo answers, empties the queue
 * with `reconcile`. The Kobo is off most of the time, so "asleep" is a normal, quiet outcome (exit 0). Never prunes.
 */
import { LockBusyError, createServiceContext, drainWithDiscovery } from "@ehub/library/services";
import { boot } from "./boot.ts";

process.env.ELIB_KOBO_QUEUE = "1";
const { config } = await boot();
const ctx = createServiceContext(config, { queue: true });

try {
  const result = await ctx.lock.runExclusive(() => drainWithDiscovery(ctx));
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
