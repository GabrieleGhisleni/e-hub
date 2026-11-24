import { mkdtemp, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryBlobStore,
  MemoryDocClient,
  TursoDocClient,
  missingHostedEnv,
  splitStatements,
  type SqlClient,
  R2BlobStore,
  listDir,
  readTextIfExists,
  removeFile,
  removeTree,
  unmountAll,
  writeFileAtomic,
  runAsUser,
} from "../src/index.ts";
import { exploreLayout, libraryLayout, mountHosted, HostedBackend } from "../src/hosted.ts";
import { mountBackend } from "../src/backend.ts";

afterEach(() => unmountAll());

describe("fs seam without a mount", () => {
  it("writes and reads real files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "store-"));
    try {
      const file = path.join(dir, "a", "b.txt");
      await writeFileAtomic(file, "ciao");
      expect(await readTextIfExists(file)).toBe("ciao");
      expect(await readFile(file, "utf8")).toBe("ciao");
      expect(await listDir(path.join(dir, "a"))).toEqual([{ name: "b.txt", isDirectory: false }]);
      await removeFile(file);
      expect(await readTextIfExists(file)).toBeNull();
      expect(await listDir(path.join(dir, "nope"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("hosted mount", () => {
  it("routes the library layout to tables and blobs", () => runAsUser("u1", async () => {
    const docs = new MemoryDocClient();
    const blobs = new MemoryBlobStore();
    mountHosted(
      { library: "/x/lib", explore: "/x/exp", notes: "/x/notes", podcasts: "/x/pod" },
      docs,
      blobs,
    );
    await writeFileAtomic("/x/lib/books/ab12cd34/book.json", JSON.stringify({ id: "ab12cd34" }));
    await writeFileAtomic("/x/lib/books/ab12cd34/notes.md", "# nota\n");
    await writeFileAtomic("/x/lib/books/ab12cd34/cover.webp", new Uint8Array([1, 2, 3]));
    expect((await docs.forUser("u1").get("books", "ab12cd34"))?.data).toEqual({ id: "ab12cd34" });
    expect((await docs.forUser("u1").get("book_markdown", "ab12cd34:notes"))?.data).toEqual({ text: "# nota\n" });
    expect(blobs.objects.has("users/u1/covers/ab12cd34.webp")).toBe(true);
    expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBe("# nota\n");
    expect(JSON.parse((await readTextIfExists("/x/lib/books/ab12cd34/book.json"))!)).toEqual({
      id: "ab12cd34",
    });
    expect(await listDir("/x/lib/books")).toEqual([{ name: "ab12cd34", isDirectory: true }]);
    await removeTree("/x/lib/books/ab12cd34");
    expect(await docs.forUser("u1").get("books", "ab12cd34")).toBeNull();
    expect(blobs.objects.size).toBe(0);
    expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBeNull();
  }));

  it("lists explorations as files and routes notes by module", () => runAsUser("u1", async () => {
    const docs = new MemoryDocClient();
    const blobs = new MemoryBlobStore();
    mountHosted(
      { library: "/x/lib", explore: "/x/exp", notes: "/x/notes", podcasts: "/x/pod" },
      docs,
      blobs,
    );
    await writeFileAtomic("/x/exp/2026-11-13-a.json", "{}");
    expect(await listDir("/x/exp")).toEqual([{ name: "2026-11-13-a.json", isDirectory: false }]);
    await writeFileAtomic("/x/notes/library/eec5cpre.json", '{"notes":[]}');
    expect((await docs.forUser("u1").get("notes", "library:eec5cpre"))?.data).toEqual({ notes: [] });
    expect(await listDir("/x/notes/library")).toEqual([{ name: "eec5cpre.json", isDirectory: false }]);
  }));

  it("leaves unrouted keys on disk", () => runAsUser("u1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "store-"));
    try {
      mountBackend(dir, new HostedBackend(new MemoryDocClient(), new MemoryBlobStore(), exploreLayout));
      await writeFileAtomic(path.join(dir, "sub", "t.txt"), "x");
      expect(await readFile(path.join(dir, "sub", "t.txt"), "utf8")).toBe("x");
      void libraryLayout;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));
});

describe("TursoDocClient (SQLite in memory, with the real migration)", () => {
  async function client() {
    const db = new DatabaseSync(":memory:");
    for (const sql of splitStatements(
      (await readFile(new URL("../../../turso/migrations/0001_init.sql", import.meta.url), "utf8")) +
        (await readFile(new URL("../../../turso/migrations/0002_per_user.sql", import.meta.url), "utf8")),
    )) {
      db.exec(sql);
    }
    const sqlClient: SqlClient = {
      async execute({ sql, args }) {
        const stmt = db.prepare(sql);
        const rows = /^\s*select/i.test(sql) ? (stmt.all(...args) as Record<string, unknown>[]) : (stmt.run(...args), []);
        return { rows };
      },
    };
    return new TursoDocClient(sqlClient).forUser("u1");
  }

  it("puts, gets, lists, replaces and deletes; key order survives", async () => {
    const docs = await client();
    expect(await docs.get("books", "a")).toBeNull();
    await docs.put("books", "b", { z: 1, a: 2 });
    await docs.put("books", "a", { x: 1 });
    expect((await docs.list("books")).map((d) => d.id)).toEqual(["a", "b"]);
    expect(Object.keys((await docs.get("books", "b"))!.data as object)).toEqual(["z", "a"]);
    await docs.put("books", "a", { x: 2 });
    expect((await docs.get("books", "a"))?.data).toEqual({ x: 2 });
    await docs.delete("books", "a");
    expect(await docs.get("books", "a")).toBeNull();
  });

  it("creates every table of the layouts", async () => {
    const docs = await client();
    for (const table of ["books", "book_summaries", "book_highlights", "book_markdown", "topics", "shows", "episodes", "conversations", "notes", "explorations", "chats", "kobo_queue"]) {
      expect(await docs.list(table)).toEqual([]);
    }
  });

  it("refuses odd table names", async () => {
    const docs = await client();
    await expect(docs.get("books; drop table books", "a")).rejects.toThrow("invalid table");
  });
});

describe("R2BlobStore", () => {
  it("sends S3 commands and maps a missing key to null", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "GetObjectCommand") {
          const error = Object.assign(new Error("x"), { name: "NoSuchKey" });
          throw error;
        }
        if (command.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "b" }, { Key: "a" }] };
        return {};
      },
    };
    const r2 = new R2BlobStore({ accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "bk", client });
    expect(await r2.get("books/x.epub")).toBeNull();
    await r2.put("books/x.epub", new Uint8Array([1]), "application/epub+zip");
    await r2.delete("books/x.epub");
    expect(await r2.list("")).toEqual(["a", "b"]);
    expect(sent.map((s) => s.name)).toEqual([
      "GetObjectCommand",
      "PutObjectCommand",
      "DeleteObjectCommand",
      "ListObjectsV2Command",
    ]);
    expect(sent[1]!.input.Bucket).toBe("bk");
  });
});

describe("libSQL in memory (tests only)", () => {
  it("works with the real client and the migration", async () => {
    expect(missingHostedEnv({})).toContain("TURSO_AUTH_TOKEN");
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: ":memory:" });
    for (const sql of splitStatements(
      (await readFile(new URL("../../../turso/migrations/0001_init.sql", import.meta.url), "utf8")) +
        (await readFile(new URL("../../../turso/migrations/0002_per_user.sql", import.meta.url), "utf8")),
    )) {
      await client.execute(sql);
    }
    const docs = new TursoDocClient(client).forUser("u1");
    await docs.put("books", "a", { x: 1 });
    expect((await docs.get("books", "a"))?.data).toEqual({ x: 1 });
  });
});
