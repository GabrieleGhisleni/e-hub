/**
 * How the app talks to the Kobo (docs/kobo-ssh-migration.md). Every path is relative to `kobo.booksDir`, which is flat:
 *
 *   <Author> - <Title> [<id>].kepub.epub             the book (uploaded from the cache)
 *   <Author> - <Title> [<id>].kepub.sdr/              KOReader sidecar folder (also holds reading progress)
 *   <Author> - <Title> [<id>].kepub.sdr/custom_metadata.lua   written by the app (series = topic label)
 *
 * `sshTransport` runs `ssh` with execFile/spawn (no local shell); `localTransport` does the same on a local folder and
 * is what the tests use. Both refuse unsafe relative paths (`assertSafeRelPath`).
 */

/** One entry directly inside `booksDir`. */
export interface KoboEntry {
  name: string;
  /** True for folders (the `.sdr` sidecars). */
  dir: boolean;
}

export interface KoboTransport {
  /** Human-readable target for messages, e.g. `root@192.168.1.11:/mnt/onboard/books`. */
  readonly description: string;
  /** Entries directly inside `booksDir` (hidden temp files starting with "." excluded), sorted by name. */
  list(): Promise<KoboEntry[]>;
  /** Lowercase hex MD5 of the given files; files that do not exist are left out of the map. */
  md5(relPaths: readonly string[]): Promise<Map<string, string>>;
  /** UTF-8 content of a file, or null when it does not exist (read-only: used to pull KOReader highlights). */
  readFile(relPath: string): Promise<string | null>;
  /** Copies a local file to `relPath`: written to a hidden temp name in the same folder first, then `mv`. */
  upload(localPath: string, relPath: string): Promise<void>;
  /** Writes UTF-8 `content` to `relPath` (parent folder created when missing), via a temp name then `mv`. */
  writeFile(relPath: string, content: string): Promise<void>;
  /** `mv` of a file or folder; fails when `to` already exists. */
  rename(from: string, to: string): Promise<void>;
  /** `rm -rf` of a file or folder (irreversible: the Kobo has no trash). Missing is not an error. */
  remove(relPath: string): Promise<void>;
  /** Flushes the Kobo's filesystem (`sync`) so the reader sees the changes. */
  flush(): Promise<void>;
}

export class UnsafeKoboPathError extends Error {
  readonly relPath: string;
  constructor(relPath: string, reason: string) {
    super(`unsafe path on the Kobo ${JSON.stringify(relPath)}: ${reason}`);
    this.name = "UnsafeKoboPathError";
    this.relPath = relPath;
  }
}

/**
 * A path relative to `booksDir`: 1 or 2 "/"-separated segments, none empty, ".", "..", or starting with "."
 * (hidden names are reserved for temp files), no NUL or control characters, no leading "/".
 */
export function assertSafeRelPath(relPath: string): void {
  if (relPath.startsWith("/")) throw new UnsafeKoboPathError(relPath, "must be relative");
  const segments = relPath.split("/");
  if (segments.length > 2) throw new UnsafeKoboPathError(relPath, "at most two segments");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..")
      throw new UnsafeKoboPathError(relPath, "empty, . or .. segment");
    if (seg.startsWith(".")) throw new UnsafeKoboPathError(relPath, "hidden names are reserved");
    if (/\p{Cc}/u.test(seg)) throw new UnsafeKoboPathError(relPath, "control characters");
  }
}
