import { describe, expect, it } from "vitest";
import {
  MemoryBlobStore,
  MemoryDocClient,
  TABLES,
  backupKey,
  createBackup,
  parseBackup,
  restoreBackup,
  runBackup,
} from "../src/index.ts";

describe("backup", () => {
  it("dumps every table to a dated gzip on the blob store and restores it", async () => {
    const docs = new MemoryDocClient();
    await docs.put("books", "ab12cd34", { id: "ab12cd34" });
    await docs.put("notes", "library:ab12cd34", { notes: [] });
    const blobs = new MemoryBlobStore();
    const result = await runBackup(docs, blobs, new Date("2026-11-18T03:30:00Z"));
    expect(result).toMatchObject({ key: "backups/2026-11-18.json.gz", documents: 2, deleted: [] });

    const restored = new MemoryDocClient();
    const file = parseBackup(blobs.objects.get(result.key)!);
    expect(Object.keys(file.tables)).toEqual([...TABLES]);
    expect(await restoreBackup(restored, file)).toBe(2);
    expect((await restored.get("books", "ab12cd34"))?.data).toEqual({ id: "ab12cd34" });
  });

  it("keeps only the newest N backups and ignores other files under the prefix", async () => {
    const docs = new MemoryDocClient();
    const blobs = new MemoryBlobStore();
    blobs.objects.set("backups/notes.txt", new Uint8Array());
    for (let day = 1; day <= 5; day += 1) {
      await runBackup(docs, blobs, new Date(Date.UTC(2026, 10, day, 3)), 3);
    }
    expect([...blobs.objects.keys()].sort()).toEqual([
      "backups/2026-11-03.json.gz",
      "backups/2026-11-04.json.gz",
      "backups/2026-11-05.json.gz",
      "backups/notes.txt",
    ]);
  });

  it("names backups by UTC date and refuses foreign files", async () => {
    expect(backupKey(new Date("2026-01-02T23:59:00Z"))).toBe("backups/2026-01-02.json.gz");
    expect(() => parseBackup(new Uint8Array([1, 2, 3]))).toThrow();
    expect((await createBackup(new MemoryDocClient())).version).toBe(1);
  });
});
