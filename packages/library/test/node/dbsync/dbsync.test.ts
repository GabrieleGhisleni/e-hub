import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Backend } from "@ehub/store";
import { applyDiff, diffLibrary } from "../../../src/node/dbsync/index.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";

/** An in-memory stand-in for the account (`RemoteBackend`). */
function fakeRemote(files: Record<string, string>): Backend & { files: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]));
  return {
    files: store,
    handles: () => true,
    readBytes: async (key) => store.get(key) ?? null,
    write: async (key, content) => {
      store.set(key, typeof content === "string" ? Buffer.from(content) : content);
      return true;
    },
    remove: async (key) => store.delete(key),
    removeTree: async () => {},
    list: async (prefix) => {
      if (prefix !== "books") return null;
      const ids = new Set([...store.keys()].filter((k) => k.startsWith("books/")).map((k) => k.split("/")[1]!));
      return [...ids].map((name) => ({ name, isDirectory: true }));
    },
  };
}

const LOCAL_ONLY = "aaaaaaa1";
const REMOTE_ONLY = "bbbbbbb2";
const BOTH = "ccccccc3";

describe("elib db diff/apply", () => {
  let tmp: TempDir;
  let dataDir: string;
  let cacheDir: string;
  beforeEach(async () => {
    tmp = await makeTempDir();
    dataDir = path.join(tmp.dir, "data");
    cacheDir = path.join(tmp.dir, "cache");
    for (const [id, title] of [[LOCAL_ONLY, "Solo qui"], [BOTH, "Locale"]] as const) {
      await mkdir(path.join(dataDir, "books", id), { recursive: true });
      await writeFile(path.join(dataDir, "books", id, "book.json"), JSON.stringify({ id, title }));
    }
    await writeFile(path.join(dataDir, "topics.json"), JSON.stringify([{ id: "a" }]));
  });
  afterEach(() => tmp.cleanup());

  it("finds what is only local, only remote, or different, and fills the gaps", async () => {
    const remote = fakeRemote({
      [`books/${REMOTE_ONLY}/book.json`]: JSON.stringify({ id: REMOTE_ONLY, title: "Solo account" }),
      [`books/${BOTH}/book.json`]: JSON.stringify({ id: BOTH, title: "Account" }),
      "topics.json": JSON.stringify([{ id: "b" }]),
    });
    const options = { dataDir, cacheDir, remote };
    const diff = await diffLibrary(options);
    const byId = new Map(diff.books.map((b) => [b.id, b]));
    expect(byId.get(LOCAL_ONLY)).toMatchObject({ local: true, remote: false, onlyLocal: ["book.json"] });
    expect(byId.get(REMOTE_ONLY)).toMatchObject({ local: false, remote: true, onlyRemote: ["book.json"] });
    expect(byId.get(BOTH)?.differing).toEqual(["book.json"]);
    expect(diff.topicsOnlyLocal).toEqual(["a"]);
    expect(diff.topicsOnlyRemote).toEqual(["b"]);

    const result = await applyDiff(diff, options);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([`${BOTH}/book.json`]); // different files wait for --prefer
    expect(remote.files.has(`books/${LOCAL_ONLY}/book.json`)).toBe(true);
    expect(await readFile(path.join(dataDir, "books", REMOTE_ONLY, "book.json"), "utf8")).toContain("Solo account");
    expect(JSON.parse(await readFile(path.join(dataDir, "topics.json"), "utf8"))).toEqual([{ id: "a" }, { id: "b" }]);

    const again = await diffLibrary(options);
    expect(again.books.map((b) => b.id)).toEqual([BOTH]);
  });

  it("resolves differing files toward the preferred side", async () => {
    const remote = fakeRemote({ [`books/${BOTH}/book.json`]: JSON.stringify({ id: BOTH, title: "Account" }) });
    const options = { dataDir, cacheDir, remote };
    await applyDiff(await diffLibrary(options), { ...options, prefer: "local" });
    expect(Buffer.from(remote.files.get(`books/${BOTH}/book.json`)!).toString()).toContain("Locale");
  });
});
