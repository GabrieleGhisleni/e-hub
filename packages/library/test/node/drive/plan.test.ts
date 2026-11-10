import { describe, expect, it } from "vitest";
import { cachedEpubPath, cachedKepubPath } from "../../../src/node/cache/index.ts";
import {
  type LibraryFile,
  type PlanInput,
  emptiedFolders,
  planReconcile,
} from "../../../src/node/drive/index.ts";
import type { DriveConfig } from "../../../src/shared/config.ts";
import { parseDriveFileName } from "../../../src/shared/naming.ts";
import { expectedDrivePaths } from "../../../src/shared/paths.ts";
import type { Topic } from "../../../src/shared/schema.ts";
import { ID_A, ID_INCOMPLETE, ID_INVALID, ID_ORPHAN, makeBook } from "./setup.ts";

const drive: DriveConfig = {
  remote: "elibtest",
  root: "",
  koboTree: "Rakuten Kobo",
  archiveTree: "Archivio",
  topicSubfolders: { kobo: true, archive: true },
};
const topics: Topic[] = [
  { id: "unsorted", label: "Da smistare" },
  { id: "narrativa", label: "Narrativa" },
  { id: "filosofia", label: "Filosofia" },
];
const CACHE = "/cache";
const book = makeBook(ID_A);
const exp = expectedDrivePaths(book, topics, drive);

function file(p: string, modTime = "2025-01-01T00:00:00Z"): LibraryFile {
  const parsed = parseDriveFileName(p);
  const name = p.slice(p.lastIndexOf("/") + 1);
  return {
    tree: p.startsWith("Rakuten Kobo") ? "kobo" : "archive",
    path: p,
    name,
    size: 1,
    modTime,
    recognized: parsed !== null,
    ...(parsed ? { id: parsed.id, kind: parsed.kind } : {}),
  };
}

function input(overrides: Partial<PlanInput>): PlanInput {
  return {
    drive,
    cacheDir: CACHE,
    topics,
    books: [book],
    files: [],
    prune: false,
    cacheHas: async () => false,
    ...overrides,
  };
}

describe("planReconcile", () => {
  it("plans nothing when both files are where they belong", async () => {
    const plan = await planReconcile(input({ files: [file(exp.epub), file(exp.kepub)] }));
    expect(plan).toEqual({ steps: [], warnings: [], errors: [] });
  });

  it("never lets a file change kind: an EPUB in the Kobo tree fills the EPUB slot, not the KEPUB one", async () => {
    const strayEpub = `Rakuten Kobo/Narrativa/X [${ID_A}].epub`;
    const plan = await planReconcile(
      input({
        files: [file(strayEpub)],
        cacheHas: async (f) => f === cachedKepubPath(CACHE, ID_A),
      }),
    );
    expect(plan.steps).toEqual([
      { type: "move", tree: "archive", from: strayEpub, to: exp.epub, bookId: ID_A },
      {
        type: "upload",
        tree: "kobo",
        from: cachedKepubPath(CACHE, ID_A),
        to: exp.kepub,
        bookId: ID_A,
      },
    ]); // no rmdir: the KEPUB upload lands in the folder the EPUB left
  });

  it("picks the copy already in the right tree, then the most recent", async () => {
    const inArchive = file(
      `Archivio/Narrativa/Newest [${ID_A}].kepub.epub`,
      "2026-01-01T00:00:00Z",
    );
    const older = file(`Rakuten Kobo/Filosofia/Older [${ID_A}].kepub.epub`, "2024-01-01T00:00:00Z");
    const newer = file(`Rakuten Kobo/Filosofia/Newer [${ID_A}].kepub.epub`, "2025-01-01T00:00:00Z");
    const plan = await planReconcile(input({ files: [older, inArchive, newer, file(exp.epub)] }));
    expect(plan.steps[0]).toMatchObject({ type: "move", from: newer.path, to: exp.kepub });
    expect(plan.warnings.map((w) => [w.code, w.path])).toEqual([
      ["duplicate-file", older.path],
      ["duplicate-file", inArchive.path],
    ]);
  });

  it("never trashes same-name twins, even with prune", async () => {
    const plan = await planReconcile(
      input({ files: [file(exp.epub), file(exp.epub), file(exp.kepub)], prune: true }),
    );
    expect(plan.steps).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toEqual(["duplicate-name"]);
  });

  it("regenerates the KEPUB from the EPUB on Drive, remembering where it was before its move", async () => {
    const stray = `Archivio/Filosofia/Old [${ID_A}].epub`;
    const plan = await planReconcile(input({ files: [file(stray)] }));
    expect(plan.errors).toEqual([]);
    expect(plan.steps[1]).toEqual({
      type: "upload",
      tree: "kobo",
      from: cachedKepubPath(CACHE, ID_A),
      to: exp.kepub,
      bookId: ID_A,
      regenerate: {
        epub: cachedEpubPath(CACHE, ID_A),
        download: { remote: exp.epub, remoteBeforeMove: stray },
      },
    });
    expect(plan.warnings.map((w) => w.code)).toEqual(["kepub-regenerated"]);
  });

  it("reports a book with nothing anywhere and an unknown topic as errors", async () => {
    const lost = await planReconcile(input({}));
    expect(lost.errors.map((e) => e.code)).toEqual(["missing-in-cache", "missing-in-cache"]);
    const unknown = await planReconcile(
      input({
        books: [makeBook(ID_A, { topic: "storia" })],
        files: [file(`Archivio/X [${ID_A}].epub`)],
        prune: true,
      }),
    );
    expect(unknown).toMatchObject({ steps: [], errors: [{ code: "unknown-topic", bookId: ID_A }] });
  });

  it("prunes orphans and foreign files only with prune, never protected IDs", async () => {
    const files = [
      file(exp.epub),
      file(exp.kepub),
      file(`Archivio/Orfano [${ID_ORPHAN}].epub`),
      file("Rakuten Kobo/foto.jpg"),
      file(`Archivio/Da smistare/Upload [${ID_INCOMPLETE}].epub`),
      file(`Rakuten Kobo/Narrativa/Rotto [${ID_INVALID}].kepub.epub`),
    ];
    const orphans = {
      knownIds: new Set([ID_A, ID_INCOMPLETE, ID_INVALID]),
      incompleteIds: new Set([ID_INCOMPLETE]),
    };
    const report = await planReconcile(input({ files, orphans }));
    expect(report.steps).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toEqual([
      "orphan-file",
      "unrecognized-file",
      "incomplete-upload",
    ]);
    const pruned = await planReconcile(input({ files, orphans, prune: true }));
    expect(pruned.steps).toEqual([
      {
        type: "trash",
        tree: "archive",
        from: `Archivio/Orfano [${ID_ORPHAN}].epub`,
        bookId: ID_ORPHAN,
      },
      { type: "trash", tree: "kobo", from: "Rakuten Kobo/foto.jpg" },
    ]);
  });
});

describe("emptiedFolders", () => {
  it("returns folders left without files, deepest first, never the tree folders", () => {
    const files = [
      { path: "Archivio/A/B/x.epub" },
      { path: "Archivio/A/y.epub" },
      { path: "Archivio/C/z.epub" },
      { path: "Rakuten Kobo/k.kepub.epub" },
    ];
    expect(
      emptiedFolders(drive, files, [
        { type: "move", tree: "archive", from: "Archivio/A/B/x.epub", to: "Archivio/C/x.epub" },
        { type: "trash", tree: "archive", from: "Archivio/A/y.epub" },
        { type: "trash", tree: "kobo", from: "Rakuten Kobo/k.kepub.epub" },
      ]),
    ).toEqual([
      { type: "rmdir", tree: "archive", from: "Archivio/A/B" },
      { type: "rmdir", tree: "archive", from: "Archivio/A" },
    ]);
  });

  it("keeps a folder that still holds a same-name twin or receives an upload", () => {
    const files = [
      { path: "Archivio/A/x.epub" },
      { path: "Archivio/A/x.epub" },
      { path: "Archivio/B/y.epub" },
    ];
    expect(
      emptiedFolders(drive, files, [
        { type: "trash", tree: "archive", from: "Archivio/A/x.epub" },
        { type: "trash", tree: "archive", from: "Archivio/B/y.epub" },
        {
          type: "upload",
          tree: "archive",
          from: "/cache/y",
          to: "Archivio/B/w.epub",
          bookId: ID_A,
        },
      ]),
    ).toEqual([]);
  });
});
