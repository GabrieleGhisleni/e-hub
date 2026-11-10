import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDuplicatesByMd5, md5File, trashBookFiles } from "../../../src/node/drive/index.ts";
import type { ReconcileReport } from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { makeTempDir } from "../../helpers/tmp.ts";
import { type DriveTestEnv, ID_A, ID_B, makeBook, setupDrive } from "./setup.ts";

const summary = (report: ReconcileReport): string[] =>
  report.actions.map((a) => `${a.type}:${a.status}:${a.from ?? ""}->${a.to ?? ""}`);

describe.skipIf(!hasBinary("rclone"))("findDuplicatesByMd5", () => {
  let t: DriveTestEnv;
  let local: string;
  let cleanupLocal: () => Promise<void>;
  beforeEach(async () => {
    t = await setupDrive();
    const tmp = await makeTempDir();
    cleanupLocal = tmp.cleanup;
    local = path.join(tmp.dir, "upload.epub");
    await writeFile(local, "same bytes");
  });
  afterEach(async () => {
    await t.cleanup();
    await cleanupLocal();
  });

  it("finds Archive files with the same MD5 (ours and foreign names)", async () => {
    await t.put(`Archivio/Narrativa/Ada Esempio - Prove [${ID_A}].epub`, "same bytes");
    await t.put("Archivio/vecchio.epub", "same bytes");
    await t.put(`Archivio/Narrativa/Altro [${ID_B}].epub`, "other bytes");
    // The Kobo tree is not searched.
    await t.put(`Rakuten Kobo/Narrativa/Ada Esempio - Prove [${ID_A}].kepub.epub`, "same bytes");

    expect(await md5File(local)).toBe(createHash("md5").update("same bytes").digest("hex"));
    const matches = await findDuplicatesByMd5(t.ctx, local);
    expect(matches).toEqual([
      { kind: "md5", path: `Archivio/Narrativa/Ada Esempio - Prove [${ID_A}].epub`, bookId: ID_A },
      { kind: "md5", path: "Archivio/vecchio.epub", bookId: null },
    ]);
  });

  it("returns nothing when no file matches or the Archive tree does not exist", async () => {
    expect(await findDuplicatesByMd5(t.ctx, local)).toEqual([]);
    await t.put(`Archivio/Narrativa/Altro [${ID_B}].epub`, "other bytes");
    expect(await findDuplicatesByMd5(t.ctx, local)).toEqual([]);
  });
});

describe.skipIf(!hasBinary("rclone"))("trashBookFiles", () => {
  let t: DriveTestEnv;
  beforeEach(async () => {
    t = await setupDrive();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("trashes every file with the ID in both trees and nothing else; dry run first", async () => {
    const a = makeBook(ID_A, { topic: "filosofia" });
    const b = makeBook(ID_B, { title: "Altro" });
    await t.addBook(a);
    await t.addBook(b);
    const expA = await t.expected(a);
    const expB = await t.expected(b);
    const dupA = `Archivio/Narrativa/Vecchio [${ID_A}].epub`;
    for (const p of [expA.epub, expA.kepub, dupA, expB.epub, expB.kepub]) await t.put(p);

    const snap = await t.snapshot();
    const planned = await trashBookFiles(t.ctx, ID_A, { dryRun: true });
    expect(await t.snapshot()).toEqual(snap);
    expect(planned.dryRun).toBe(true);
    expect(summary(planned)).toEqual([
      `trash:planned:${expA.kepub}->`,
      `trash:planned:${expA.epub}->`,
      `trash:planned:${dupA}->`,
      "rmdir:planned:Rakuten Kobo/Filosofia->",
      "rmdir:planned:Archivio/Filosofia->",
    ]);

    const done = await trashBookFiles(t.ctx, ID_A);
    expect(done.errors).toEqual([]);
    expect(summary(done)).toEqual(summary(planned).map((s) => s.replace(":planned:", ":done:")));
    expect(await t.remoteFiles()).toEqual([expB.epub, expB.kepub].sort());
    expect(await t.remoteDirs()).toEqual([
      "Archivio",
      "Archivio/Narrativa",
      "Rakuten Kobo",
      "Rakuten Kobo/Narrativa",
    ]);

    const again = await trashBookFiles(t.ctx, ID_A);
    expect(again.actions).toEqual([]);
    expect(again.warnings.map((w) => w.code)).toEqual(["no-files"]);
  });

  it("rejects anything that is not a book ID", async () => {
    await expect(trashBookFiles(t.ctx, "../Archivio")).rejects.toThrow(/invalid book ID/);
  });
});
