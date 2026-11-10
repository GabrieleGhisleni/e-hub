import { describe, expect, it } from "vitest";
import { ElibConfigSchema } from "../../src/shared/config.ts";
import { BOOK_KEY_ORDER, BookSchema, TopicsFileSchema } from "../../src/shared/schema.ts";

const minimal = {
  id: "7k2m9q4t",
  title: "Sapiens",
  authors: ["Yuval Noah Harari"],
  topic: "saggistica",
  status: "to-read",
};

describe("BookSchema", () => {
  it("accepts the minimal book", () => {
    expect(BookSchema.parse(minimal)).toEqual(minimal);
  });

  it("preserves unknown keys", () => {
    const parsed = BookSchema.parse({
      ...minimal,
      myNote: "scritto a mano",
      nested: { a: [1, 2] },
    });
    expect(parsed).toMatchObject({ myNote: "scritto a mano", nested: { a: [1, 2] } });
  });

  it("accepts every optional field", () => {
    const full = {
      ...minimal,
      tags: ["storia"],
      startedAt: "2026-01-02",
      finishedAt: "2026-02-28",
      rating: 5,
      isbn: "9788845292613",
      openLibraryCoverId: 12345,
      publisher: "Bompiani",
      language: "it",
      description: "…",
      subjects: ["History"],
    };
    expect(BookSchema.parse(full)).toEqual(full);
  });

  it.each([
    ["missing title", { ...minimal, title: undefined }],
    ["blank title", { ...minimal, title: "   " }],
    ["empty authors", { ...minimal, authors: [] }],
    ["bad status", { ...minimal, status: "done" }],
    ["bad id", { ...minimal, id: "ABCDEFGH" }],
    ["bad topic id", { ...minimal, topic: "Saggistica" }],
    ["bad date", { ...minimal, startedAt: "2026-02-30" }],
    ["date with time", { ...minimal, finishedAt: "2026-02-01T10:00:00Z" }],
    ["rating out of range", { ...minimal, rating: 6 }],
    ["fractional rating", { ...minimal, rating: 3.5 }],
    ["cover id as string", { ...minimal, openLibraryCoverId: "123" }],
  ])("rejects %s", (_, value) => {
    expect(BookSchema.safeParse(value).success).toBe(false);
  });

  it("BOOK_KEY_ORDER lists exactly the known keys", () => {
    expect([...BOOK_KEY_ORDER].sort()).toEqual(Object.keys(BookSchema.shape).sort());
  });
});

describe("TopicsFileSchema", () => {
  const unsorted = { id: "unsorted", label: "Da smistare" };
  it("accepts a valid list", () => {
    expect(TopicsFileSchema.safeParse([unsorted, { id: "storia", label: "Storia" }]).success).toBe(
      true,
    );
  });
  it("requires unsorted", () => {
    expect(TopicsFileSchema.safeParse([{ id: "storia", label: "Storia" }]).success).toBe(false);
  });
  it("rejects duplicate ids", () => {
    expect(TopicsFileSchema.safeParse([unsorted, unsorted]).success).toBe(false);
  });
  it("rejects labels that map to the same Drive folder", () => {
    const result = TopicsFileSchema.safeParse([
      unsorted,
      { id: "a-b", label: "A/B" },
      { id: "a-b-2", label: "a-b" },
    ]);
    expect(result.success).toBe(false);
  });
  it("keeps unknown keys on topics", () => {
    expect(TopicsFileSchema.parse([{ ...unsorted, color: "grey" }])[0]).toMatchObject({
      color: "grey",
    });
  });
});

describe("ElibConfigSchema", () => {
  const config = {
    drive: {
      remote: "elib",
      root: "",
      koboTree: "Rakuten Kobo",
      archiveTree: "Archivio",
      topicSubfolders: { kobo: true, archive: true },
    },
    cache: { dir: "~/.cache/e-library" },
    server: { port: 8787, allowedOrigins: ["http://127.0.0.1:5173"] },
    site: { basePath: "/e-library/" },
  };
  it("accepts the default config", () => {
    expect(ElibConfigSchema.safeParse(config).success).toBe(true);
  });
  it.each([
    ["absolute root", { ...config, drive: { ...config.drive, root: "/Libri" } }],
    ["parent root", { ...config, drive: { ...config.drive, root: "Libri/../x" } }],
    ["remote with colon", { ...config, drive: { ...config.drive, remote: "elib:" } }],
    ["tree with slash", { ...config, drive: { ...config.drive, koboTree: "Rakuten/Kobo" } }],
    [
      "origin with path",
      { ...config, server: { ...config.server, allowedOrigins: ["http://x:1/a"] } },
    ],
    ["base without slash", { ...config, site: { basePath: "e-library" } }],
  ])("rejects %s", (_, value) => {
    expect(ElibConfigSchema.safeParse(value).success).toBe(false);
  });
});
