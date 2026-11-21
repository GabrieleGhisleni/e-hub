/**
 * The hosted backend: maps the file layout of each package (`books/<id>/book.json`, `shows/<slug>.json`, …) onto
 * Turso tables (`id`, `data jsonb`, `updated_at`) and an R2 bucket. Keys that no route claims stay on disk
 * (the Pi keeps podcast audio and caches there).
 */
import { type Backend, type DirEntry, type FileChange, mountBackend } from "./backend.ts";
import { type BlobStore, scopedBlobs } from "./blobs.ts";
import { type DocClient, type UserDocs } from "./docs.ts";
import { requireUserId } from "./user-context.ts";

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

/** The route of `key` in a layout, if any (shared by the hosted backend, the remote client and the API). */
export function routeFor(layout: Layout, key: string): { route: Route; m: RegExpMatchArray } | null {
  for (const route of layout.routes) {
    const m = key.match(route.match);
    if (m) return { route, m };
  }
  return null;
}

export const LAYOUTS: Record<keyof DataRoots, Layout> = {
  get library() {
    return libraryLayout;
  },
  get explore() {
    return exploreLayout;
  },
  get notes() {
    return notesLayout;
  },
  get podcasts() {
    return podcastsLayout;
  },
};

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

  /** The data of the user of the current request. Throws outside one: nothing here is reachable without a user. */
  private scope(): { docs: UserDocs; blobs: BlobStore } {
    const userId = requireUserId();
    return { docs: this.docs.forUser(userId), blobs: scopedBlobs(this.blobs, userId) };
  }

  private route(key: string): { route: Route; m: RegExpMatchArray } | null {
    return routeFor(this.layout, key);
  }

  handles(key: string): boolean {
    return this.route(key) !== null;
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const hit = this.route(key);
    if (!hit) return null;
    const { route, m } = hit;
    const { docs, blobs } = this.scope();
    if (route.kind === "blob") return blobs.get(route.blobKey!(m));
    const doc = await docs.get(route.table, route.id(m));
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
    const { docs, blobs } = this.scope();
    if (route.kind === "blob") {
      const body = typeof content === "string" ? Buffer.from(content) : content;
      await blobs.put(route.blobKey!(m), body, contentTypeOf(key));
      return true;
    }
    const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    const data = route.kind === "text" ? { text } : (JSON.parse(text) as unknown);
    await docs.put(route.table, route.id(m), data);
    return true;
  }

  async batch(changes: FileChange[]): Promise<void> {
    await this.scope().docs.batch(changes.map(({ key, content }) => {
      const hit = this.route(key);
      if (!hit || hit.route.kind !== "json") throw new Error("Batch requires JSON documents");
      return { table: hit.route.table, id: hit.route.id(hit.m), data: content === undefined ? undefined : JSON.parse(content) };
    }));
  }

  async remove(key: string): Promise<boolean> {
    const hit = this.route(key);
    if (!hit) return false;
    const { route, m } = hit;
    const { docs, blobs } = this.scope();
    if (route.kind === "blob") await blobs.delete(route.blobKey!(m));
    else await docs.delete(route.table, route.id(m));
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
    const docs = await this.scope().docs.list(listing.table);
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
    { match: /^topics\.json$/, kind: "json", table: "topics", id: () => "all" }, // one row per user
    { match: /^kobo-queue\/([^/.][^/]*)\.json$/, kind: "json", table: "kobo_queue", id: (m) => m[1]! },
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
  listings: [
    { dir: "books", table: "books", as: "dirs" },
    { dir: "kobo-queue", table: "kobo_queue", as: "files" },
  ],
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

/** Podcast documents are scoped to the authenticated user; audio and caches stay on disk. */
export const podcastsLayout: Layout = {
  routes: [
    { match: /^shows\/([^/.][^/]*)\.json$/, kind: "json", table: "shows", id: (m) => m[1]! },
    { match: /^episodes\/([^/.][^/]*)\.json$/, kind: "json", table: "episodes", id: (m) => m[1]! },
    { match: /^transcripts\/([^/.][^/]*)\.json$/, kind: "json", table: "podcast_transcripts", id: (m) => m[1]! },
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
    { dir: "transcripts", table: "podcast_transcripts", as: "files" },
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
