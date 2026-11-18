/**
 * The storage seam. Every package reads and writes its data through `readTextIfExists`, `writeFileAtomic` & co.
 * When the path lies under a *mounted* root (the hosted API mounts each package's data dir on Supabase/R2) the call
 * goes to that backend; everywhere else (tests with a temp dir, local CLI, caches on disk) it is plain `node:fs`.
 */
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** A store addressed by posix keys relative to its mounted root (`books/ab12cd34/book.json`). */
export interface Backend {
  readBytes(key: string): Promise<Uint8Array | null>;
  /** `undefined` when the key is not routed here: the caller falls back to the real file system. */
  write(key: string, content: string | Uint8Array): Promise<boolean>;
  /** Removes one file; no-op when missing. Returns false when the key is not routed here. */
  remove(key: string): Promise<boolean>;
  /** Removes everything under `prefix` among the routed keys. */
  removeTree(prefix: string): Promise<void>;
  /** Entries directly under `prefix`; `null` when the prefix is not routed here. */
  list(prefix: string): Promise<DirEntry[] | null>;
  /** Whether `key` is handled by this backend (reads of unrouted keys fall back to disk). */
  handles(key: string): boolean;
}

const mounts = new Map<string, Backend>();

/** Mounts `backend` on the absolute directory `root`. Replaces an earlier mount of the same root. */
export function mountBackend(root: string, backend: Backend): void {
  mounts.set(path.resolve(root), backend);
}

export function unmountBackend(root: string): void {
  mounts.delete(path.resolve(root));
}

export function unmountAll(): void {
  mounts.clear();
}

interface Resolved {
  backend: Backend;
  key: string;
}

function resolveMount(absPath: string): Resolved | null {
  const target = path.resolve(absPath);
  let best: { root: string; backend: Backend } | undefined;
  for (const [root, backend] of mounts) {
    if (target === root || target.startsWith(root + path.sep)) {
      if (!best || root.length > best.root.length) best = { root, backend };
    }
  }
  if (!best) return null;
  const key = path.relative(best.root, target).split(path.sep).join("/");
  return { backend: best.backend, key };
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function readBytesIfExists(file: string): Promise<Uint8Array | null> {
  const mounted = resolveMount(file);
  if (mounted?.backend.handles(mounted.key)) return mounted.backend.readBytes(mounted.key);
  try {
    return await readFile(file);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** File contents as UTF-8, or null when the file does not exist. */
export async function readTextIfExists(file: string): Promise<string | null> {
  const bytes = await readBytesIfExists(file);
  return bytes === null ? null : Buffer.from(bytes).toString("utf8");
}

/** Writes atomically (temp file + rename on disk; one upsert on a mounted backend). Creates the directory. */
export async function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void> {
  const mounted = resolveMount(file);
  if (mounted?.backend.handles(mounted.key) && (await mounted.backend.write(mounted.key, content))) {
    return;
  }
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Removes one file; no-op when it does not exist. */
export async function removeFile(file: string): Promise<void> {
  const mounted = resolveMount(file);
  if (mounted?.backend.handles(mounted.key) && (await mounted.backend.remove(mounted.key))) return;
  await rm(file, { force: true });
}

/** Removes a directory and everything in it; no-op when it does not exist. */
export async function removeTree(dir: string): Promise<void> {
  const mounted = resolveMount(dir);
  if (mounted) await mounted.backend.removeTree(mounted.key);
  await rm(dir, { recursive: true, force: true });
}

/** Entries of a directory (hidden `.` entries included); `[]` when it does not exist. */
export async function listDir(dir: string): Promise<DirEntry[]> {
  const mounted = resolveMount(dir);
  if (mounted) {
    const entries = await mounted.backend.list(mounted.key);
    if (entries) return entries;
  }
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

/** True when `file` is stored on a mounted backend (so it does not exist as a local path). */
export function isMounted(file: string): boolean {
  const mounted = resolveMount(file);
  return !!mounted?.backend.handles(mounted.key);
}

/** A backend that keeps everything in a Map. For tests. */
export class MemoryBackend implements Backend {
  readonly files = new Map<string, Uint8Array>();

  handles(): boolean {
    return true;
  }
  async readBytes(key: string): Promise<Uint8Array | null> {
    return this.files.get(key) ?? null;
  }
  async write(key: string, content: string | Uint8Array): Promise<boolean> {
    this.files.set(key, typeof content === "string" ? Buffer.from(content) : content);
    return true;
  }
  async remove(key: string): Promise<boolean> {
    this.files.delete(key);
    return true;
  }
  async removeTree(prefix: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) this.files.delete(key);
    }
  }
  async list(prefix: string): Promise<DirEntry[] | null> {
    const base = prefix === "" ? "" : `${prefix}/`;
    const seen = new Map<string, boolean>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(rest, seen.get(rest) ?? false);
      else seen.set(rest.slice(0, slash), true);
    }
    return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
  }
}
