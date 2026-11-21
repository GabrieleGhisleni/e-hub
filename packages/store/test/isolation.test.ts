import { readFile, readdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DATA_TABLES,
  MemoryBlobStore,
  NoUserError,
  TursoDocClient,
  UserConflictError,
  applyMigrations,
  ensureOwner,
  listDir,
  loginUser,
  readBytesIfExists,
  readTextIfExists,
  removeFile,
  removeTree,
  runAsUser,
  scopedBlobs,
  unmountAll,
  tryFileBatch,
  userScopedDir,
  writeFileAtomic,
} from "../src/index.ts";
import { mountHosted } from "../src/hosted.ts";

const MIGRATIONS = new URL("../../../turso/migrations/", import.meta.url);

async function database() {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: ":memory:" });
  const files = await Promise.all(
    (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort().map(async (name) => ({
      name,
      sql: await readFile(new URL(name, MIGRATIONS), "utf8"),
    })),
  );
  return { client, files, docs: new TursoDocClient(client as never) };
}

const ROOTS = { library: "/x/lib", explore: "/x/exp", notes: "/x/notes", podcasts: "/x/pod" };
afterEach(() => unmountAll());

describe("migrations", () => {
  it("apply once, in order, and cover every data table", async () => {
    const { client, files } = await database();
    expect(await applyMigrations(client as never, files)).toEqual(files.map((f) => f.name));
    expect(await applyMigrations(client as never, files)).toEqual([]);
    for (const table of DATA_TABLES) {
      const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => [r.name, r.pk]);
      expect(cols, table).toEqual(expect.arrayContaining([["user_id", 1], ["id", 2]]));
    }
  });

  it("keeps rows that existed before 0002 under the user 'legacy'", async () => {
    const { client, files } = await database();
    await applyMigrations(client as never, [files[0]!]);
    await client.execute("INSERT INTO books (id, data, updated_at) VALUES ('b1', '{\"x\":1}', 't')");
    await applyMigrations(client as never, files);
    const { docs } = { docs: new TursoDocClient(client as never) };
    expect((await docs.forUser("legacy").get("books", "b1"))?.data).toEqual({ x: 1 });
  });
});

describe("user isolation (libSQL in memory, hosted backend)", () => {
  async function setup() {
    const { client, files, docs } = await database();
    await applyMigrations(client as never, files);
    const blobs = new MemoryBlobStore();
    mountHosted(ROOTS, docs, blobs);
    return { docs, blobs };
  }

  it("throws without a user instead of touching data", async () => {
    await setup();
    await expect(readTextIfExists("/x/lib/books/ab12cd34/book.json")).rejects.toBeInstanceOf(NoUserError);
    await expect(writeFileAtomic("/x/lib/books/ab12cd34/book.json", "{}")).rejects.toBeInstanceOf(NoUserError);
    await expect(listDir("/x/lib/books")).rejects.toBeInstanceOf(NoUserError);
  });

  it("B does not see, overwrite or delete the rows of A, by list or by id", async () => {
    const { docs } = await setup();
    await runAsUser("userA", async () => {
      await writeFileAtomic("/x/lib/books/ab12cd34/book.json", '{"owner":"A"}');
      await writeFileAtomic("/x/lib/topics.json", '{"topics":["a"]}');
      await writeFileAtomic("/x/exp/e1.json", '{"owner":"A"}');
      await writeFileAtomic("/x/notes/library/ab12cd34.json", '{"owner":"A"}');
      await writeFileAtomic("/x/lib/books/ab12cd34/notes.md", "segreto di A");
    });
    await runAsUser("userB", async () => {
      expect(await listDir("/x/lib/books")).toEqual([]);
      expect(await listDir("/x/exp")).toEqual([]);
      expect(await listDir("/x/notes/library")).toEqual([]);
      expect(await readTextIfExists("/x/lib/books/ab12cd34/book.json")).toBeNull();
      expect(await readTextIfExists("/x/lib/topics.json")).toBeNull();
      expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBeNull();
      // Same id, own row: does not touch A's.
      await writeFileAtomic("/x/lib/books/ab12cd34/book.json", '{"owner":"B"}');
      await writeFileAtomic("/x/lib/topics.json", '{"topics":["b"]}');
      await removeFile("/x/exp/e1.json");
      await removeTree("/x/lib/books/ab12cd34");
    });
    await runAsUser("userA", async () => {
      expect(JSON.parse((await readTextIfExists("/x/lib/books/ab12cd34/book.json"))!)).toEqual({ owner: "A" });
      expect(JSON.parse((await readTextIfExists("/x/lib/topics.json"))!)).toEqual({ topics: ["a"] });
      expect(await readTextIfExists("/x/exp/e1.json")).not.toBeNull();
      expect(await readTextIfExists("/x/lib/books/ab12cd34/notes.md")).toBe("segreto di A");
    });
    // One topics row per user.
    expect((await docs.forUser("userA").list("topics")).map((d) => d.id)).toEqual(["all"]);
    expect((await docs.forUser("userB").list("topics")).map((d) => d.data)).toEqual([{ topics: ["b"] }]);
  });

  it("files in R2 live under users/<id>/ and are invisible to others", async () => {
    const { blobs } = await setup();
    await runAsUser("userA", () => writeFileAtomic("/x/lib/books/ab12cd34/cover.webp", new Uint8Array([1, 2])));
    expect([...blobs.objects.keys()]).toEqual(["users/userA/covers/ab12cd34.webp"]);
    await runAsUser("userB", async () => {
      expect(await readBytesIfExists("/x/lib/books/ab12cd34/cover.webp")).toBeNull();
      await removeFile("/x/lib/books/ab12cd34/cover.webp");
    });
    expect(blobs.objects.size).toBe(1);
  });

  it("scopedBlobs refuses path tricks and listings of other prefixes", async () => {
    const raw = new MemoryBlobStore();
    await raw.put("users/userB/secret", new Uint8Array([9]));
    const a = scopedBlobs(raw, "userA");
    await expect(a.get("../userB/secret")).rejects.toThrow();
    expect(await a.get("secret")).toBeNull();
    expect(await a.list("")).toEqual([]);
  });

  it("the cache dir of a user is separate", () => {
    expect(userScopedDir("/c")).toBe("/c");
    expect(runAsUser("123", () => userScopedDir("/c"))).toBe("/c/users/123");
    expect(() => runAsUser("email:a@b.it", () => userScopedDir("/c"))).toThrow();
    expect(() => runAsUser("../x", () => 1)).toThrow();
  });
});

describe("login and owner claim", () => {
  it("creates a user, updates name and email on later logins", async () => {
    const { docs } = await database().then(async (d) => (await applyMigrations(d.client as never, d.files), d));
    const first = await loginUser(docs, null, { sub: "111", email: "A@x.it", name: "A" });
    expect(first).toMatchObject({ id: "111", email: "a@x.it", name: "A" });
    const again = await loginUser(docs, null, { sub: "111", email: "a@x.it", name: "A2" });
    expect(again.name).toBe("A2");
    expect(again.createdAt).toBe(first.createdAt);
  });

  it("the placeholder owner of the migration becomes the real user at first login, data and files included", async () => {
    const { client, files, docs } = await database();
    await applyMigrations(client as never, files);
    const blobs = new MemoryBlobStore();
    mountHosted(ROOTS, docs, blobs);
    const owner = await ensureOwner(docs, "Me@X.it");
    expect(owner.id).toBe("email:me@x.it");
    await runAsUser(owner.id, async () => {
      await writeFileAtomic("/x/lib/books/ab12cd34/book.json", '{"mine":true}');
      await writeFileAtomic("/x/lib/books/ab12cd34/cover.webp", new Uint8Array([7]));
    });
    await blobs.put("users/email:me@x.it/books/ab12cd34.epub", new Uint8Array([5]));
    await loginUser(docs, blobs, { sub: "999", email: "me@x.it", name: "Io" });
    expect(await docs.users.findById("email:me@x.it")).toBeNull();
    await runAsUser("999", async () => {
      expect(await readTextIfExists("/x/lib/books/ab12cd34/book.json")).toContain("mine");
      expect(await readBytesIfExists("/x/lib/books/ab12cd34/cover.webp")).toEqual(new Uint8Array([7]));
    });
    expect([...blobs.objects.keys()].sort()).toEqual([
      "users/999/books/ab12cd34.epub",
      "users/999/covers/ab12cd34.webp",
    ]);
    await runAsUser("email:me@x.it", async () => expect(await listDir("/x/lib/books")).toEqual([]));
  });

  it("refuses a second Google account claiming an email already bound to another sub", async () => {
    const { client, files, docs } = await database();
    await applyMigrations(client as never, files);
    await loginUser(docs, null, { sub: "1", email: "a@x.it", name: "A" });
    await expect(loginUser(docs, null, { sub: "2", email: "a@x.it", name: "A" })).rejects.toBeInstanceOf(UserConflictError);
  });
});


it("rolls back an episode insert if the transcript insert fails", async () => {
  const { client, files, docs } = await database();
  await applyMigrations(client as never, files);
  mountHosted(ROOTS, docs, new MemoryBlobStore());
  await client.execute("CREATE TRIGGER reject_transcript BEFORE INSERT ON podcast_transcripts BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const changes = [
    { file: "/x/pod/episodes/demo.json", content: "{}" },
    { file: "/x/pod/transcripts/demo.json", content: "{}" },
  ];
  await expect(runAsUser("u1", () => tryFileBatch(changes))).rejects.toThrow(/test failure/);
  expect(await docs.forUser("u1").get("episodes", "demo")).toBeNull();
  await client.execute("DROP TRIGGER reject_transcript");
  expect(await runAsUser("u1", () => tryFileBatch(changes))).toBe(true);
  expect(await docs.forUser("u1").get("podcast_transcripts", "demo")).not.toBeNull();
  expect(await docs.forUser("u2").get("podcast_transcripts", "demo")).toBeNull();
});
