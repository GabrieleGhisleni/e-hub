import { afterEach, describe, expect, it } from "vitest";
import {
  HostedBackend,
  libraryLayout,
} from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, unmountAll } from "@ehub/store";
import {
  deleteBookDir,
  listBookIds,
  readAllBooks,
  readBook,
  readBookMarkdown,
  readTopics,
  writeBook,
  writeBookMarkdown,
  writeTopics,
} from "../../src/node/repo/index.ts";
import { saveCover } from "../../src/node/covers/index.ts";
import { existsSync } from "node:fs";

afterEach(() => unmountAll());

const ROOT = "/nonexistent/hosted-library-data";

describe("library repo on a hosted (mounted) data dir", () => {
  it("keeps books, markdown, covers and topics in the doc and blob stores, not on disk", async () => {
    const docs = new MemoryDocClient();
    const blobs = new MemoryBlobStore();
    mountBackend(ROOT, new HostedBackend(docs, blobs, libraryLayout));

    await writeTopics(ROOT, [
      { id: "unsorted", label: "Da sistemare" },
      { id: "narrativa", label: "Narrativa" },
    ]);
    expect((await readTopics(ROOT)).map((t) => t.id)).toEqual(["unsorted", "narrativa"]);

    await writeBook(ROOT, {
      id: "ab12cd34",
      title: "Il giardino delle prove",
      authors: ["Ada Esempio"],
      topic: "narrativa",
      status: "to-read",
    });
    await writeBookMarkdown(ROOT, "ab12cd34", "notes", "Una nota");
    await saveCover(ROOT, "ab12cd34", new Uint8Array([1, 2, 3]));

    expect((await readBook(ROOT, "ab12cd34")).title).toBe("Il giardino delle prove");
    expect(await readBookMarkdown(ROOT, "ab12cd34", "notes")).toBe("Una nota\n");
    expect(await listBookIds(ROOT)).toEqual(["ab12cd34"]);
    const all = await readAllBooks(ROOT);
    expect(all.books.map((b) => b.id)).toEqual(["ab12cd34"]);
    expect(blobs.objects.has("covers/ab12cd34.webp")).toBe(true);
    expect(existsSync(ROOT)).toBe(false);

    await deleteBookDir(ROOT, "ab12cd34");
    expect(await listBookIds(ROOT)).toEqual([]);
    expect(blobs.objects.size).toBe(0);
    expect(await readBookMarkdown(ROOT, "ab12cd34", "notes")).toBeNull();
  });
});
