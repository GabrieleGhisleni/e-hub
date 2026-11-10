import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RcloneError, createRclone, listLibraryFiles } from "../../../src/node/drive/index.ts";
import type { Rclone } from "../../../src/node/drive/index.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { type LocalRemote, createLocalRemote } from "../../helpers/rclone.ts";
import { type TempDir, makeTempDir } from "../../helpers/tmp.ts";

describe.skipIf(!hasBinary("rclone"))("rclone wrapper on a local remote", () => {
  let remote: LocalRemote;
  let tmp: TempDir;
  let rclone: Rclone;
  const put = async (remotePath: string, content = "x"): Promise<void> => {
    await mkdir(path.dirname(remote.localPath(remotePath)), { recursive: true });
    await writeFile(remote.localPath(remotePath), content);
  };

  beforeEach(async () => {
    remote = await createLocalRemote();
    tmp = await makeTempDir();
    rclone = createRclone({ drive: remote.driveConfig(), env: remote.env });
  });
  afterEach(async () => {
    await remote.cleanup();
    await tmp.cleanup();
  });

  it("lists recursively with paths relative to the remote root; missing folders are optional", async () => {
    await put("Archivio/Narrativa/A [7k2m9q4t].epub", "12345");
    const entries = await rclone.lsjson("Archivio", { recursive: true, filesOnly: true });
    expect(entries).toMatchObject([
      {
        path: "Archivio/Narrativa/A [7k2m9q4t].epub",
        name: "A [7k2m9q4t].epub",
        size: 5,
        isDir: false,
      },
    ]);
    expect(await rclone.lsjson("Archivio", { dirsOnly: true })).toMatchObject([
      { path: "Archivio/Narrativa", isDir: true },
    ]);
    expect(await rclone.lsjson("Rakuten Kobo", { missingOk: true })).toEqual([]);
    const error = await rclone.lsjson("Rakuten Kobo").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RcloneError);
    expect((error as RcloneError).exitCode).toBe(3);
    expect((error as RcloneError).stderr).toMatch(/directory not found/);
  });

  it("indexes both trees and flags names that are not ours", async () => {
    await put("Rakuten Kobo/N/A [7K2M9Q4T].kepub.epub");
    await put("Archivio/note.txt");
    expect(await listLibraryFiles(rclone)).toMatchObject([
      {
        tree: "kobo",
        path: "Rakuten Kobo/N/A [7K2M9Q4T].kepub.epub",
        recognized: true,
        id: "7k2m9q4t",
        kind: "kepub",
      },
      { tree: "archive", path: "Archivio/note.txt", recognized: false },
    ]);
  });

  it("uploads, moves, downloads atomically and deletes; never overwrites", async () => {
    const local = path.join(tmp.dir, "book.epub");
    await writeFile(local, "BOOK");
    await rclone.copyTo(local, "Archivio/N/a.epub");
    await rclone.moveTo("Archivio/N/a.epub", "Rakuten Kobo/b.epub");
    expect(await readFile(remote.localPath("Rakuten Kobo/b.epub"), "utf8")).toBe("BOOK");

    // An existing destination is left alone (and the source is kept).
    await writeFile(local, "OTHER");
    await rclone.copyTo(local, "Rakuten Kobo/b.epub");
    expect(await readFile(remote.localPath("Rakuten Kobo/b.epub"), "utf8")).toBe("BOOK");

    const target = path.join(tmp.dir, "cache", "books", "x", "book.epub");
    await rclone.download("Rakuten Kobo/b.epub", target);
    expect(await readFile(target, "utf8")).toBe("BOOK");
    expect(await readdir(path.dirname(target))).toEqual(["book.epub"]); // no temp file left

    await rclone.deleteFile("Rakuten Kobo/b.epub");
    const error = await rclone.deleteFile("Rakuten Kobo/b.epub").catch((e: unknown) => e);
    expect((error as RcloneError).exitCode).toBe(4);
  });

  it("md5sum returns lowercase hashes with remote-root paths", async () => {
    await put("Archivio/N/a.epub", "hello\n");
    expect(await rclone.md5sum("Archivio")).toEqual([
      { md5: "b1946ac92492d2347c6235b4d2611184", path: "Archivio/N/a.epub" },
    ]);
    expect(await rclone.md5sum("Rakuten Kobo", { missingOk: true })).toEqual([]);
  });

  it("moves a folder; rmdirs removes only empty folders and never the tree", async () => {
    await put("Rakuten Kobo/Old/a.kepub.epub");
    await rclone.moveDir("Rakuten Kobo/Old", "Rakuten Kobo/New");
    expect(await readdir(remote.localPath("Rakuten Kobo"))).toEqual(["New"]);
    await rclone.mkdir("Rakuten Kobo/Empty/Deeper");
    await rclone.rmdirs("Rakuten Kobo");
    expect(await readdir(remote.localPath("Rakuten Kobo"))).toEqual(["New"]);
    await rclone.deleteFile("Rakuten Kobo/New/a.kepub.epub");
    await rclone.rmdirs("Rakuten Kobo");
    expect(await readdir(remote.localPath("Rakuten Kobo"))).toEqual([]);
    await rclone.rmdirs("Archivio"); // missing tree: no-op
  });

  it("reports a missing binary as an RcloneError", async () => {
    const broken = createRclone({ drive: remote.driveConfig(), binary: "/nonexistent/rclone" });
    const error = await broken.lsjson("").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RcloneError);
    expect((error as RcloneError).exitCode).toBeNull();
  });
});
