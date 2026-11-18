/**
 * The laptop's view of the hosted data: a backend that talks to the API's `/api/store/<root>/<key>` routes with the
 * user's session token. Mounted over the same data dirs, it lets the existing CLIs (`explore`, `elib`, `episode`)
 * work on the hosted data unchanged: they validate, the API validates again before it stores anything.
 */
import path from "node:path";
import { type Backend, type DirEntry, mountBackend } from "./backend.ts";
import { type DataRoots, type Layout, LAYOUTS, routeFor } from "./hosted.ts";

export class RemoteStoreError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RemoteStoreError";
    this.status = status;
  }
}

export interface RemoteOptions {
  /** `https://<api>` */
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export class RemoteBackend implements Backend {
  private readonly root: string;
  private readonly layout: Layout;
  private readonly base: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  // Plain fields, no parameter properties: this file may be loaded by Node's type stripping.
  constructor(root: keyof DataRoots, options: RemoteOptions) {
    this.root = root;
    this.layout = LAYOUTS[root];
    this.base = `${options.apiUrl.replace(/\/+$/, "")}/api/store/${root}`;
    this.token = options.token;
    this.fetchFn = options.fetch ?? fetch;
  }

  private url(key: string, query = ""): string {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}${query}`;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchFn(url, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => "");
      throw new RemoteStoreError(
        `API ${init.method ?? "GET"} ${this.root}: HTTP ${response.status} ${detail.slice(0, 200)}`,
        response.status,
      );
    }
    return response;
  }

  handles(key: string): boolean {
    return routeFor(this.layout, key) !== null;
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const response = await this.call(this.url(key));
    return response.status === 404 ? null : new Uint8Array(await response.arrayBuffer());
  }

  async write(key: string, content: string | Uint8Array): Promise<boolean> {
    if (!this.handles(key)) return false;
    const body = typeof content === "string" ? content : new Uint8Array(content);
    await this.call(this.url(key), {
      method: "PUT",
      headers: { "content-type": key.endsWith(".json") ? "application/json" : "application/octet-stream" },
      body,
    });
    return true;
  }

  async remove(key: string): Promise<boolean> {
    if (!this.handles(key)) return false;
    await this.call(this.url(key), { method: "DELETE" });
    return true;
  }

  async removeTree(prefix: string): Promise<void> {
    await this.call(this.url(prefix, "?tree=1"), { method: "DELETE" });
  }

  async list(prefix: string): Promise<DirEntry[] | null> {
    if (!this.layout.listings.some((l) => l.dir === prefix)) return null;
    const response = await this.call(`${this.base}?list=${encodeURIComponent(prefix)}`);
    if (response.status === 404) return null;
    return (await response.json()) as DirEntry[];
  }
}

export interface RemoteEnv {
  EHUB_API_URL?: string | undefined;
  EHUB_API_TOKEN?: string | undefined;
}

/** True when the environment asks for the remote store (`EHUB_API_URL` and `EHUB_API_TOKEN`). */
export function remoteConfigured(env: RemoteEnv = process.env): boolean {
  return Boolean(env.EHUB_API_URL && env.EHUB_API_TOKEN);
}

/**
 * Mounts the remote backend over every data dir given. A CLI calls this first thing, with the dirs its package knows;
 * without `EHUB_API_URL`/`EHUB_API_TOKEN` it does nothing and the CLI works on local files as before.
 */
export function mountRemoteFromEnv(
  roots: Partial<Record<keyof DataRoots, string>>,
  env: RemoteEnv = process.env,
  fetchFn?: typeof fetch,
): boolean {
  if (!remoteConfigured(env)) return false;
  for (const [name, dir] of Object.entries(roots) as [keyof DataRoots, string][]) {
    mountBackend(path.resolve(dir), new RemoteBackend(name, {
      apiUrl: env.EHUB_API_URL!,
      token: env.EHUB_API_TOKEN!,
      ...(fetchFn ? { fetch: fetchFn } : {}),
    }));
  }
  return true;
}
