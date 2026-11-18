/**
 * The Kobo's address changes with DHCP. First choice is a DHCP reservation; this is the fallback: when the configured
 * host does not answer, look for something listening on the Kobo's SSH port in the Pi's /24 and accept it only if an
 * SSH login succeeds with `StrictHostKeyChecking=yes` under the Kobo's `HostKeyAlias`, i.e. only the real Kobo.
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { KoboConfig } from "../../shared/config.ts";
import type { KoboContext } from "./context.ts";
import { koboReachable } from "./queue.ts";
import { sshTransport } from "./ssh.ts";

/** `192.168.1.0/24` neighbours of every non-internal IPv4 interface (own address excluded). */
export function subnetCandidates(
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): string[] {
  const out = new Set<string>();
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const [a, b, c, d] = i.address.split(".");
      for (let host = 1; host <= 254; host += 1) {
        if (String(host) !== d) out.add(`${a}.${b}.${c}.${host}`);
      }
    }
  }
  return [...out];
}

export function tcpOpen(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface DiscoveryDeps {
  candidates?: () => string[];
  /** Is something listening on `port` at `ip`? */
  open?: (ip: string, port: number) => Promise<boolean>;
  /** Does an SSH login to the Kobo (strict host key) succeed at this `user@ip`? */
  verify?: (kobo: KoboConfig) => Promise<boolean>;
  concurrency?: number;
}

const userOf = (host: string): string => (host.includes("@") ? host.slice(0, host.indexOf("@")) : "root");

/** The `user@ip` of the Kobo found on the LAN, or null. */
export async function discoverKoboHost(
  kobo: KoboConfig,
  deps: DiscoveryDeps = {},
): Promise<string | null> {
  if (!kobo.hostKeyAlias) return null; // without a host key alias the check would accept the wrong device
  const candidates = (deps.candidates ?? subnetCandidates)();
  const open = deps.open ?? ((ip, port) => tcpOpen(ip, port));
  const verify =
    deps.verify ??
    (async (k: KoboConfig) => {
      try {
        await sshTransport(k).list();
        return true;
      } catch {
        return false;
      }
    });
  const concurrency = deps.concurrency ?? 32;
  const listening: string[] = [];
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((ip) => open(ip, kobo.port)));
    batch.forEach((ip, n) => results[n] && listening.push(ip));
  }
  for (const ip of listening) {
    const host = `${userOf(kobo.host)}@${ip}`;
    if (await verify({ ...kobo, host })) return host;
  }
  return null;
}

const HOST_CACHE = "kobo-host";

/**
 * A resolver for `drainKoboQueue`: the configured host, then the one remembered from last time, then discovery.
 * The address that worked is remembered in `<cache>/kobo-host`.
 */
export function koboResolver(deps: DiscoveryDeps & { makeContext: (host: string) => KoboContext }) {
  return async (ctx: KoboContext): Promise<KoboContext | null> => {
    if (await koboReachable(ctx)) return ctx;
    const file = path.join(ctx.cacheDir, HOST_CACHE);
    const remembered = (await readFile(file, "utf8").catch(() => "")).trim();
    if (remembered && remembered !== ctx.kobo.host) {
      const next = deps.makeContext(remembered);
      if (await koboReachable(next)) return next;
    }
    const found = await discoverKoboHost(ctx.kobo, deps);
    if (!found) return null;
    await writeFile(file, `${found}\n`).catch(() => undefined);
    return deps.makeContext(found);
  };
}
