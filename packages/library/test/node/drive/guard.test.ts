import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UnsafeRemotePathError,
  assertDistinctTrees,
  assertSafeRemotePath,
  createRclone,
} from "../../../src/node/drive/index.ts";
import type { DriveConfig } from "../../../src/shared/config.ts";

const drive = (overrides: Partial<DriveConfig> = {}): DriveConfig => ({
  remote: "elibtest",
  root: "",
  koboTree: "Rakuten Kobo",
  archiveTree: "Archivio",
  topicSubfolders: { kobo: true, archive: true },
  ...overrides,
});

describe("assertSafeRemotePath", () => {
  const flat = drive();
  const rooted = drive({ root: "Libri" });

  it.each([
    ["/Rakuten Kobo/x.epub", /absolute/],
    ["..", /segments/],
    ["Rakuten Kobo/../x.epub", /segments/],
    ["Rakuten Kobo/./x.epub", /segments/],
    ["Rakuten Kobo//x.epub", /empty path segment/],
    ["Rakuten Kobo/x.epub/", /empty path segment/],
    ["Rakuten Kobo\\x.epub", /backslash/],
    ["Rakuten Kobo/x\n.epub", /control/],
  ])("rejects %j for every access", (p, reason) => {
    for (const access of ["read", "read-file", "tree-dir", "tree-entry"] as const) {
      expect(() => assertSafeRemotePath(flat, p, access)).toThrow(UnsafeRemotePathError);
      expect(() => assertSafeRemotePath(flat, p, access)).toThrow(reason);
    }
  });

  it("keeps reads inside drive.root", () => {
    expect(assertSafeRemotePath(flat, "", "read")).toBeNull();
    expect(assertSafeRemotePath(flat, "_vecchio", "read")).toBeNull();
    expect(assertSafeRemotePath(rooted, "Libri", "read")).toBeNull();
    expect(assertSafeRemotePath(rooted, "Libri/Archivio", "read")).toBe("archive");
    expect(() => assertSafeRemotePath(rooted, "", "read")).toThrow(/outside the drive root/);
    expect(() => assertSafeRemotePath(rooted, "Altro", "read")).toThrow(/outside/);
    expect(() => assertSafeRemotePath(rooted, "Libri2/Archivio", "read")).toThrow(/outside/);
    expect(() => assertSafeRemotePath(flat, "", "read-file")).toThrow(UnsafeRemotePathError);
    expect(() => assertSafeRemotePath(rooted, "Libri", "read-file")).toThrow(/not a file/);
    expect(assertSafeRemotePath(rooted, "Libri/Archivio/x.epub", "read-file")).toBe("archive");
  });

  it("keeps writes inside the two trees, and never on a tree folder itself", () => {
    expect(assertSafeRemotePath(flat, "Rakuten Kobo/N/x.kepub.epub", "tree-entry")).toBe("kobo");
    expect(assertSafeRemotePath(flat, "Archivio/x.epub", "tree-entry")).toBe("archive");
    expect(assertSafeRemotePath(flat, "Rakuten Kobo", "tree-dir")).toBe("kobo");
    expect(assertSafeRemotePath(rooted, "Libri/Archivio/N", "tree-dir")).toBe("archive");
    for (const p of ["", "_vecchio/x.epub", "Rakuten Kobo2/x.epub", "Archiviox", "x.epub"]) {
      expect(() => assertSafeRemotePath(flat, p, "tree-entry")).toThrow(/only allowed inside/);
      expect(() => assertSafeRemotePath(flat, p, "tree-dir")).toThrow(/only allowed inside/);
    }
    expect(() => assertSafeRemotePath(flat, "Rakuten Kobo", "tree-entry")).toThrow(
      /tree folder itself/,
    );
    expect(() => assertSafeRemotePath(rooted, "Archivio/x.epub", "tree-entry")).toThrow(
      /only allowed inside/,
    );
    expect(() => assertSafeRemotePath(rooted, "Libri", "tree-dir")).toThrow(/only allowed inside/);
  });

  it("rejects configs whose two trees are the same folder", () => {
    expect(() => assertDistinctTrees(drive({ archiveTree: "rakuten kobo" }))).toThrow(
      /must be different/,
    );
    expect(() => createRclone({ drive: drive({ archiveTree: "Rakuten Kobo" }) })).toThrow(
      UnsafeRemotePathError,
    );
  });
});

describe("createRclone (dry run, no process is spawned)", () => {
  // A binary that cannot exist: any spawn would fail the test.
  const rclone = createRclone({ drive: drive(), binary: "/nonexistent/rclone", dryRun: true });

  it("records writes with the trash and no-clobber flags instead of running them", async () => {
    await rclone.copyTo("relative/book.epub", "Archivio/N/x [7k2m9q4t].epub");
    await rclone.moveTo("Archivio/N/x [7k2m9q4t].epub", "Rakuten Kobo/x [7k2m9q4t].epub");
    await rclone.moveDir("Archivio/N", "Archivio/M");
    await rclone.deleteFile("Archivio/M/x [7k2m9q4t].epub");
    await rclone.rmdirs("Archivio");
    await rclone.mkdir("Archivio/New");
    await rclone.download("Archivio/M/y.epub", "/tmp/never-written/book.epub");
    expect(rclone.planned.map((op) => op.op)).toEqual([
      "copyto",
      "moveto",
      "movedir",
      "deletefile",
      "rmdirs",
      "mkdir",
      "download",
    ]);
    const [copy, move, moveDir, del, rmdirs] = rclone.planned;
    // Local paths are made absolute: never mistaken for a flag or a `remote:` spec.
    expect(copy?.args).toEqual([
      "copyto",
      "--ignore-existing",
      "--drive-use-trash=true",
      path.resolve("relative/book.epub"),
      "elibtest:Archivio/N/x [7k2m9q4t].epub",
    ]);
    expect(move?.args).toContain("--ignore-existing");
    expect(moveDir?.args.slice(0, 3)).toEqual([
      "moveto",
      "--ignore-existing",
      "--drive-use-trash=true",
    ]);
    expect(del?.args).toEqual([
      "deletefile",
      "--drive-use-trash=true",
      "elibtest:Archivio/M/x [7k2m9q4t].epub",
    ]);
    expect(rmdirs?.args).toEqual([
      "rmdirs",
      "--leave-root",
      "--drive-use-trash=true",
      "elibtest:Archivio",
    ]);
    expect(rclone.withDryRun().dryRun).toBe(true);
  });

  it("refuses unsafe paths even in dry run", async () => {
    await expect(rclone.moveTo("Rakuten Kobo/a.epub", "../b.epub")).rejects.toThrow(
      UnsafeRemotePathError,
    );
    await expect(rclone.deleteFile("Rakuten Kobo")).rejects.toThrow(/tree folder itself/);
    await expect(rclone.deleteFile("")).rejects.toThrow(UnsafeRemotePathError);
    await expect(rclone.deleteFile("_vecchio/a.epub")).rejects.toThrow(/only allowed inside/);
    await expect(rclone.copyTo("/tmp/a.epub", "/Archivio/a.epub")).rejects.toThrow(/absolute/);
    await expect(rclone.copyTo("", "Archivio/a.epub")).rejects.toThrow(/empty local path/);
    await expect(rclone.moveDir("Archivio/N", "Rakuten Kobo/N")).rejects.toThrow(/same tree/);
    await expect(rclone.moveDir("Archivio/N", "Archivio/N/M")).rejects.toThrow(/into itself/);
    await expect(rclone.moveTo("Archivio/a.epub", "Archivio/a.epub")).rejects.toThrow(/same/);
    await expect(rclone.rmdirs("")).rejects.toThrow(/only allowed inside/);
    await expect(rclone.download("Archivio/../../etc/passwd", "/tmp/x")).rejects.toThrow(
      UnsafeRemotePathError,
    );
  });
});

describe("Drive module source", () => {
  it("only rclone.ts spawns processes, with no forbidden verb and never without the trash", async () => {
    const dir = fileURLToPath(new URL("../../../src/node/drive/", import.meta.url));
    for (const name of await readdir(dir)) {
      const source = await readFile(path.join(dir, name), "utf8");
      expect(source).not.toMatch(/use-trash=false|use_trash|--drive-use-trash(?!=true)/);
      expect(source).not.toMatch(/(?<![.\w])exec\(|shell:\s*true|execSync|spawnSync/);
      if (name !== "rclone.ts") expect(source, name).not.toMatch(/child_process/);
    }
    const rclone = await readFile(path.join(dir, "rclone.ts"), "utf8");
    // String literals only (comments may name the forbidden verbs).
    for (const verb of ["sync", "purge", "delete", "rmdir", "cleanup", "dedupe", "move", "copy"]) {
      expect(rclone, `rclone ${verb}`).not.toMatch(new RegExp(`["']${verb}["']`));
    }
  });
});
