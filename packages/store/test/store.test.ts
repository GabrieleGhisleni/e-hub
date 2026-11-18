import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryBlobStore,
  MemoryDocClient,
  SupabaseDocClient,
  R2BlobStore,
  listDir,
  readTextIfExists,
  removeFile,
  removeTree,
  unmountAll,
  writeFileAtomic,
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
  it("routes the library layout to tables and blobs", async () => {
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
    expect((await docs.get("books", "ab12cd34"))?.data).toEqual({ id: "ab12cd34" });
    expect((await docs.get("book_markdown", "ab12cd34:notes"))?.data).toEqual({ text: "# nota\n" });
    expect(blobs.objects.has("covers/ab12cd34.webp")).toBe(true);
    expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBe("# nota\n");
    expect(JSON.parse((await readTextIfExists("/x/lib/books/ab12cd34/book.json"))!)).toEqual({
      id: "ab12cd34",
    });
    expect(await listDir("/x/lib/books")).toEqual([{ name: "ab12cd34", isDirectory: true }]);
    await removeTree("/x/lib/books/ab12cd34");
    expect(await docs.get("books", "ab12cd34")).toBeNull();
    expect(blobs.objects.size).toBe(0);
    expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBeNull();
  });

  it("lists explorations as files and routes notes by module", async () => {
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
    expect((await docs.get("notes", "library:eec5cpre"))?.data).toEqual({ notes: [] });
    expect(await listDir("/x/notes/library")).toEqual([{ name: "eec5cpre.json", isDirectory: false }]);
  });

  it("leaves unrouted keys on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "store-"));
    try {
      mountBackend(dir, new HostedBackend(new MemoryDocClient(), new MemoryBlobStore(), exploreLayout));
      await writeFileAtomic(path.join(dir, "sub", "t.txt"), "x");
      expect(await readFile(path.join(dir, "sub", "t.txt"), "utf8")).toBe("x");
      void libraryLayout;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SupabaseDocClient", () => {
  it("speaks PostgREST", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = init.method === "POST" || init.method === "DELETE" ? "" : '[{"id":"a","data":{"x":1},"updated_at":"t"}]';
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new SupabaseDocClient({ url: "https://p.supabase.co/", serviceRoleKey: "k", fetch: fake });
    expect(await client.get("books", "a")).toEqual({ id: "a", data: { x: 1 }, updatedAt: "t" });
    expect(calls[0]!.url).toBe("https://p.supabase.co/rest/v1/books?id=eq.a&select=id,data,updated_at");
    await client.put("books", "a", { x: 2 });
    expect(calls[1]!.url).toContain("on_conflict=id");
    expect(JSON.parse(calls[1]!.init.body as string)).toMatchObject({ id: "a", data: { x: 2 } });
    await client.delete("books", "a");
    expect(calls[2]!.init.method).toBe("DELETE");
    await expect(client.get("books; drop", "a")).rejects.toThrow("invalid table");
  });

  it("surfaces errors without the key", async () => {
    const fake = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const client = new SupabaseDocClient({ url: "https://p.supabase.co", serviceRoleKey: "SECRET", fetch: fake });
    const error = await client.list("books").catch((e: Error) => e);
    expect((error as Error).message).toMatch(/401/);
    expect((error as Error).message).not.toMatch(/SECRET/);
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
