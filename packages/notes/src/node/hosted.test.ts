import { afterEach, describe, expect, it } from "vitest";
import { HostedBackend, notesLayout } from "@ehub/store/hosted";
import { MemoryBlobStore, MemoryDocClient, mountBackend, unmountAll } from "@ehub/store";
import { DATA_DIR_ENV, addNote, listAllNotes, listItemNotes, removeNote } from "./repo.ts";

afterEach(() => {
  unmountAll();
  delete process.env[DATA_DIR_ENV];
});

describe("notes on a hosted data dir", () => {
  it("are rows of the `notes` table, one per item", async () => {
    const docs = new MemoryDocClient();
    process.env[DATA_DIR_ENV] = "/nonexistent/hosted-notes";
    mountBackend("/nonexistent/hosted-notes", new HostedBackend(docs, new MemoryBlobStore(), notesLayout));
    const item = { module: "library" as const, id: "78w462eb", title: "T", href: "/library/book/78w462eb" };
    const id = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
    await addNote({ id, item, body: "ciao", pinned: false });
    expect(await docs.get("notes", "library:78w462eb")).not.toBeNull();
    expect((await listItemNotes("library", "78w462eb")).map((n) => n.body)).toEqual(["ciao"]);
    expect(await listAllNotes()).toHaveLength(1);
    await removeNote({ module: "library", itemId: "78w462eb", noteId: id });
    expect(await docs.get("notes", "library:78w462eb")).toBeNull();
  });
});
