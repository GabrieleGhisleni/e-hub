import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcile, renameTopicFolders } from "../../../src/node/drive/index.ts";
import { readTopics, writeTopics } from "../../../src/node/repo/index.ts";
import type { ReconcileReport } from "../../../src/shared/api.ts";
import { hasBinary } from "../../helpers/binaries.ts";
import { type DriveTestEnv, ID_A, ID_B, ID_C, makeBook, setupDrive } from "./setup.ts";

const summary = (report: ReconcileReport): string[] =>
  report.actions.map((a) => `${a.type}:${a.status}:${a.from ?? ""}->${a.to ?? ""}`);
const noop = { dryRun: false, actions: [], warnings: [], errors: [] };

async function seed(t: DriveTestEnv): Promise<void> {
  for (const book of [
    makeBook(ID_A),
    makeBook(ID_B, { title: "Secondo" }),
    makeBook(ID_C, { title: "Terzo", topic: "filosofia" }),
  ]) {
    await t.addBook(book);
    const exp = await t.expected(book);
    await t.put(exp.epub);
    await t.put(exp.kepub);
  }
}

async function relabel(t: DriveTestEnv, id: string, label: string): Promise<void> {
  const topics = await readTopics(t.env.dataDir);
  await writeTopics(
    t.env.dataDir,
    topics.map((topic) => (topic.id === id ? { ...topic, label } : topic)),
  );
}

describe.skipIf(!hasBinary("rclone"))("renameTopicFolders", () => {
  let t: DriveTestEnv;
  beforeEach(async () => {
    t = await setupDrive();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("renames the topic folder in both trees; dry run first changes nothing", async () => {
    await seed(t);
    await relabel(t, "narrativa", "Romanzi");

    const snap = await t.snapshot();
    const planned = await renameTopicFolders(t.ctx, "Narrativa", "Romanzi", { dryRun: true });
    expect(await t.snapshot()).toEqual(snap);
    expect(planned.dryRun).toBe(true);
    expect(planned.errors).toEqual([]);
    // Only the two folder moves: the books are planned as if the folders had already moved.
    expect(summary(planned)).toEqual([
      "move:planned:Rakuten Kobo/Narrativa->Rakuten Kobo/Romanzi",
      "move:planned:Archivio/Narrativa->Archivio/Romanzi",
    ]);

    const done = await renameTopicFolders(t.ctx, "Narrativa", "Romanzi");
    expect(done.errors).toEqual([]);
    expect(summary(done)).toEqual([
      "move:done:Rakuten Kobo/Narrativa->Rakuten Kobo/Romanzi",
      "move:done:Archivio/Narrativa->Archivio/Romanzi",
    ]);
    expect(await t.remoteDirs()).toEqual([
      "Archivio",
      "Archivio/Filosofia",
      "Archivio/Romanzi",
      "Rakuten Kobo",
      "Rakuten Kobo/Filosofia",
      "Rakuten Kobo/Romanzi",
    ]);
    for (const book of [makeBook(ID_A), makeBook(ID_B, { title: "Secondo" })]) {
      const exp = await t.expected(book);
      expect(await t.read(exp.epub)).not.toBeNull();
      expect(await t.read(exp.kepub)).not.toBeNull();
    }
    expect(await reconcile(t.ctx, "all")).toEqual(noop);
  });

  it("moves the files one by one when the new folder already exists", async () => {
    await seed(t);
    await mkdir(t.env.remote.localPath("Rakuten Kobo/Romanzi"), { recursive: true });
    await relabel(t, "narrativa", "Romanzi");

    const report = await renameTopicFolders(t.ctx, "Narrativa", "Romanzi");
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => [w.code, w.path])).toEqual([
      ["topic-folder-exists", "Rakuten Kobo/Romanzi"],
    ]);
    const a = await t.expected(makeBook(ID_A));
    const b = await t.expected(makeBook(ID_B, { title: "Secondo" }));
    expect(summary(report)).toEqual([
      "move:done:Archivio/Narrativa->Archivio/Romanzi",
      `move:done:${a.kepub.replace("/Romanzi/", "/Narrativa/")}->${a.kepub}`,
      `move:done:${b.kepub.replace("/Romanzi/", "/Narrativa/")}->${b.kepub}`,
      "rmdir:done:Rakuten Kobo/Narrativa->",
    ]);
    expect(await t.remoteDirs()).not.toContain("Rakuten Kobo/Narrativa");
    expect(await reconcile(t.ctx, "all")).toEqual(noop);
  });

  it("only touches the Archive tree when the Kobo tree is flat", async () => {
    await t.cleanup();
    t = await setupDrive({ drive: { topicSubfolders: { kobo: false, archive: true } } });
    await seed(t);
    await relabel(t, "narrativa", "Romanzi");

    const report = await renameTopicFolders(t.ctx, "Narrativa", "Romanzi");
    expect(report.errors).toEqual([]);
    expect(summary(report)).toEqual(["move:done:Archivio/Narrativa->Archivio/Romanzi"]);
    expect(await reconcile(t.ctx, "all")).toEqual(noop);
  });

  it("does nothing on Drive when the folder name does not change", async () => {
    await seed(t);
    await relabel(t, "narrativa", "Narrativa?"); // "?" is dropped from folder names
    const report = await renameTopicFolders(t.ctx, "Narrativa", "Narrativa?");
    expect(report).toEqual(noop);
  });
});
