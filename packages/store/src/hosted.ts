/**
 * The hosted backend: maps the file layout of each package (`books/<id>/book.json`, `shows/<slug>.json`, …) onto
 * Turso tables (`id`, `data jsonb`, `updated_at`) and an R2 bucket. Keys that no route claims stay on disk
 * (the Pi keeps podcast audio, transcripts and caches there).
 */
import { type Backend, type DirEntry, mountBackend } from "./backend.ts";
import { type BlobStore } from "./blobs.ts";
import { type DocClient } from "./docs.ts";

export type RouteKind = "json" | "text" | "blob";

export interface Route {
  /** Matches the whole key. */
  match: RegExp;
  kind: RouteKind;
  /** For json/text: the table and the row id. For blob: ignored. */
  table: string;
  id: (m: RegExpMatchArray) => string;
  /** For blob: the object key in the bucket. */
  blobKey?: (m: RegExpMatchArray) => string;
}

/** `dir` (a key prefix) lists the ids of `table` as directories or as `<id>.json` files. */
export interface Listing {
  dir: string;
  table: string;
  idPrefix?: string;
  as: "dirs" | "files";
}

/** Removing the tree under a key removes these keys. */
export interface Tree {
  match: RegExp;
  keys: (m: RegExpMatchArray) => string[];
}

export interface Layout {
  routes: Route[];
  listings: Listing[];
  trees?: Tree[];
}

const JSON_TEXT = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export class HostedBackend implements Backend {
  private readonly docs: DocClient;
  private readonly blobs: BlobStore;
  private readonly layout: Layout;

  // Plain fields, no parameter properties: this file may be loaded by Node's type stripping.
  constructor(docs: DocClient, blobs: BlobStore, layout: Layout) {
    this.docs = docs;
    this.blobs = blobs;
    this.layout = layout;
  }

  private route(key: string): { route: Route; m: RegExpMatchArray } | null {
    for (const route of this.layout.routes) {
      const m = key.match(route.match);
      if (m) return { route, m };
    }
    return null;
  }

  handles(key: string): boolean {
    return this.route(key) !== null;
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const hit = this.route(key);
    if (!hit) return null;
    const { route, m } = hit;
    if (route.kind === "blob") return this.blobs.get(route.blobKey!(m));
    const doc = await this.docs.get(route.table, route.id(m));
    if (!doc) return null;
    if (route.kind === "text") {
      const text = (doc.data as { text?: unknown } | null)?.text;
      return Buffer.from(typeof text === "string" ? text : "");
    }
    return Buffer.from(JSON_TEXT(doc.data));
  }

  async write(key: string, content: string | Uint8Array): Promise<boolean> {
    const hit = this.route(key);
    if (!hit) return false;
    const { route, m } = hit;
    if (route.kind === "blob") {
      const body = typeof content === "string" ? Buffer.from(content) : content;
      await this.blobs.put(route.blobKey!(m), body, contentTypeOf(key));
      return true;
    }
    const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    const data = route.kind === "text" ? { text } : (JSON.parse(text) as unknown);
    await this.docs.put(route.table, route.id(m), data);
    return true;
  }

  async remove(key: string): Promise<boolean> {
    const hit = this.route(key);
    if (!hit) return false;
    const { route, m } = hit;
    if (route.kind === "blob") await this.blobs.delete(route.blobKey!(m));
    else await this.docs.delete(route.table, route.id(m));
    return true;
  }

  async removeTree(prefix: string): Promise<void> {
    for (const tree of this.layout.trees ?? []) {
      const m = prefix.match(tree.match);
      if (!m) continue;
      for (const key of tree.keys(m)) await this.remove(key);
    }
  }

  async list(prefix: string): Promise<DirEntry[] | null> {
    const listing = this.layout.listings.find((l) => l.dir === prefix);
    if (!listing) return null;
    const docs = await this.docs.list(listing.table);
    const idPrefix = listing.idPrefix ?? "";
    return docs
      .filter((d) => d.id.startsWith(idPrefix))
      .map((d) => d.id.slice(idPrefix.length))
      .map((name) =>
        listing.as === "dirs"
          ? { name, isDirectory: true }
          : { name: `${name}.json`, isDirectory: false },
      );
  }
}

function contentTypeOf(key: string): string | undefined {
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".epub")) return "application/epub+zip";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

const ID = "([^/]+)";

/** `packages/library/data`: books, per-book files, topics. Covers go to R2. */
export const libraryLayout: Layout = {
  routes: [
    { match: /^topics\.json$/, kind: "json", table: "topics", id: () => "all" },
    { match: new RegExp(`^books/${ID}/book\\.json$`), kind: "json", table: "books", id: (m) => m[1]! },
    {
      match: new RegExp(`^books/${ID}/summary\\.json$`),
      kind: "json",
      table: "book_summaries",
      id: (m) => m[1]!,
    },
    {
      match: new RegExp(`^books/${ID}/highlights\\.json$`),
      kind: "json",
      table: "book_highlights",
      id: (m) => m[1]!,
    },
    {
      match: new RegExp(`^books/${ID}/(notes|recall|study)\\.md$`),
      kind: "text",
      table: "book_markdown",
      id: (m) => `${m[1]}:${m[2]}`,
    },
    {
      match: new RegExp(`^books/${ID}/cover\\.webp$`),
      kind: "blob",
      table: "",
      id: () => "",
      blobKey: (m) => `covers/${m[1]}.webp`,
    },
  ],
  listings: [{ dir: "books", table: "books", as: "dirs" }],
  trees: [
    {
      match: new RegExp(`^books/${ID}$`),
      keys: (m) => [
        `books/${m[1]}/book.json`,
        `books/${m[1]}/summary.json`,
        `books/${m[1]}/highlights.json`,
        `books/${m[1]}/notes.md`,
        `books/${m[1]}/recall.md`,
        `books/${m[1]}/study.md`,
        `books/${m[1]}/cover.webp`,
      ],
    },
  ],
};

/** `packages/explore/data`: `<id>.json` per exploration. */
export const exploreLayout: Layout = {
  routes: [
    {
      match: /^([^/.][^/]*)\.json$/,
      kind: "json",
      table: "explorations",
      id: (m) => m[1]!,
    },
  ],
  listings: [{ dir: "", table: "explorations", as: "files" }],
};

/** `packages/notes/data`: `<module>/<itemId>.json`. */
export const notesLayout: Layout = {
  routes: [
    {
      match: /^(library|podcasts)\/([^/.][^/]*)\.json$/,
      kind: "json",
      table: "notes",
      id: (m) => `${m[1]}:${m[2]}`,
    },
  ],
  listings: [
    { dir: "library", table: "notes", idPrefix: "library:", as: "files" },
    { dir: "podcasts", table: "notes", idPrefix: "podcasts:", as: "files" },
  ],
};

/** `packages/podcasts/data`: shows, episodes, conversations. Transcripts, audio and caches stay on disk. */
export const podcastsLayout: Layout = {
  routes: [
    { match: /^shows\/([^/.][^/]*)\.json$/, kind: "json", table: "shows", id: (m) => m[1]! },
    { match: /^episodes\/([^/.][^/]*)\.json$/, kind: "json", table: "episodes", id: (m) => m[1]! },
    {
      match: /^conversations\/([^/.][^/]*)\.json$/,
      kind: "json",
      table: "conversations",
      id: (m) => m[1]!,
    },
  ],
  listings: [
    { dir: "shows", table: "shows", as: "files" },
    { dir: "episodes", table: "episodes", as: "files" },
    { dir: "conversations", table: "conversations", as: "files" },
  ],
};

export interface DataRoots {
  library: string;
  explore: string;
  notes: string;
  podcasts: string;
}

/** Mounts the four data directories on the hosted backend. Call once at startup of the Pi server. */
export function mountHosted(roots: DataRoots, docs: DocClient, blobs: BlobStore): void {
  mountBackend(roots.library, new HostedBackend(docs, blobs, libraryLayout));
  mountBackend(roots.explore, new HostedBackend(docs, blobs, exploreLayout));
  mountBackend(roots.notes, new HostedBackend(docs, blobs, notesLayout));
  mountBackend(roots.podcasts, new HostedBackend(docs, blobs, podcastsLayout));
}
