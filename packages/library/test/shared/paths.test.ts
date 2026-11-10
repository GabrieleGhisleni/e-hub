import { describe, expect, it } from "vitest";
import type { DriveConfig } from "../../src/shared/config.ts";
import {
  UnknownTopicError,
  driveTopicDir,
  driveTreeDir,
  expectedDrivePaths,
  remoteSpec,
} from "../../src/shared/paths.ts";

const topics = [
  { id: "unsorted", label: "Da smistare" },
  { id: "saggistica", label: "Saggistica" },
  { id: "scienze-sociali", label: "Scienze: società/politica" },
];
const book = {
  id: "7k2m9q4t",
  title: "Sapiens: Da animali a dèi",
  authors: ["Yuval Noah Harari"],
  topic: "saggistica",
};
const drive = (overrides: Partial<DriveConfig> = {}): DriveConfig => ({
  remote: "elib",
  root: "",
  koboTree: "Rakuten Kobo",
  archiveTree: "Archivio",
  topicSubfolders: { kobo: true, archive: true },
  ...overrides,
});
const NAME = "Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t]";

describe("expectedDrivePaths", () => {
  it("puts topic subfolders in both trees by default", () => {
    expect(expectedDrivePaths(book, topics, drive())).toEqual({
      kepub: `Rakuten Kobo/Saggistica/${NAME}.kepub.epub`,
      epub: `Archivio/Saggistica/${NAME}.epub`,
    });
  });

  it("honors the per-tree subfolder flags", () => {
    expect(
      expectedDrivePaths(book, topics, drive({ topicSubfolders: { kobo: false, archive: true } })),
    ).toEqual({
      kepub: `Rakuten Kobo/${NAME}.kepub.epub`,
      epub: `Archivio/Saggistica/${NAME}.epub`,
    });
    expect(
      expectedDrivePaths(book, topics, drive({ topicSubfolders: { kobo: true, archive: false } })),
    ).toEqual({
      kepub: `Rakuten Kobo/Saggistica/${NAME}.kepub.epub`,
      epub: `Archivio/${NAME}.epub`,
    });
    expect(
      expectedDrivePaths(book, topics, drive({ topicSubfolders: { kobo: false, archive: false } })),
    ).toEqual({
      kepub: `Rakuten Kobo/${NAME}.kepub.epub`,
      epub: `Archivio/${NAME}.epub`,
    });
  });

  it("honors root and tree names", () => {
    const config = drive({
      root: "Libri-test/e-library",
      koboTree: "Kobo",
      archiveTree: "Originali",
    });
    expect(expectedDrivePaths(book, topics, config)).toEqual({
      kepub: `Libri-test/e-library/Kobo/Saggistica/${NAME}.kepub.epub`,
      epub: `Libri-test/e-library/Originali/Saggistica/${NAME}.epub`,
    });
  });

  it("uses the sanitized topic label as folder name", () => {
    const paths = expectedDrivePaths({ ...book, topic: "scienze-sociali" }, topics, drive());
    expect(paths.epub).toBe(`Archivio/Scienze - società-politica/${NAME}.epub`);
  });

  it("throws UnknownTopicError for a topic that is not in topics.json", () => {
    expect(() => expectedDrivePaths({ ...book, topic: "manca" }, topics, drive())).toThrow(
      UnknownTopicError,
    );
  });
});

describe("tree helpers", () => {
  it("builds tree and topic dirs", () => {
    expect(driveTreeDir(drive(), "kobo")).toBe("Rakuten Kobo");
    expect(driveTreeDir(drive({ root: "Libri" }), "archive")).toBe("Libri/Archivio");
    expect(driveTopicDir(drive(), "archive", "Da smistare")).toBe("Archivio/Da smistare");
    expect(
      driveTopicDir(
        drive({ topicSubfolders: { kobo: false, archive: true } }),
        "kobo",
        "Da smistare",
      ),
    ).toBe("Rakuten Kobo");
    expect(remoteSpec(drive(), "Archivio/x.epub")).toBe("elib:Archivio/x.epub");
  });
});
