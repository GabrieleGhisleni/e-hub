import { describe, expect, it, vi } from "vitest";
import { createHttpNotesStore, createMemoryNotesStore, createStaticNotesStore } from "./store";
import { matchesTokens, searchTokens } from "./text";
import type { Note, NoteItemRef } from "./types";

const book: NoteItemRef = {
  module: "library",
  id: "b1",
  title: "Old title",
  href: "/library/book/b1",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("memory notes store", () => {
  it("adds, pins, edits and removes notes", () => {
    let tick = 0;
    const store = createMemoryNotesStore([], () => new Date(Date.UTC(2026, 10, 10, 12, 0, tick++)));
    const note = store.add(book, "  first thought  ");
    expect(note.body).toBe("first thought");

    store.update(note.id, { pinned: true });
    expect(store.getAll()[0]).toMatchObject({ pinned: true, updatedAt: note.updatedAt });

    store.update(note.id, { body: "edited" });
    expect(store.getAll()[0]!.body).toBe("edited");
    expect(store.getAll()[0]!.updatedAt).not.toBe(note.createdAt);

    store.remove(note.id);
    expect(store.getAll()).toEqual([]);
  });

  it("keeps the snapshot stable until something changes, and notifies subscribers", () => {
    const store = createMemoryNotesStore();
    const before = store.getAll();
    expect(store.getAll()).toBe(before);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.add(book, "x");
    expect(calls).toBe(1);
    unsubscribe();
    store.add(book, "y");
    expect(calls).toBe(1);
  });

  it("refreshes the item snapshot of older notes when a new note is added", () => {
    const store = createMemoryNotesStore();
    store.add(book, "a");
    store.add({ ...book, title: "New title" }, "b");
    expect(store.getAll().map((n) => n.item.title)).toEqual(["New title", "New title"]);
  });
});

describe("static notes store", () => {
  it("is read-only and drops entries that are not notes (or point outside their module)", () => {
    const valid: Note = {
      id: "1",
      item: book,
      body: "x",
      pinned: false,
      createdAt: "2026-11-10T12:00:00.000Z",
      updatedAt: "2026-11-10T12:00:00.000Z",
    };
    const store = createStaticNotesStore([
      valid,
      { id: 2 },
      { ...valid, id: "3", item: { ...book, href: "javascript:alert(1)" } },
    ]);
    expect(store.getAll().map((n) => n.id)).toEqual(["1"]);
    expect(store.getMeta()).toMatchObject({ readOnly: true, status: "ready" });
    expect(() => store.add(book, "y")).toThrow();
  });
});

/** A fake notes API: records requests, answers like the server. */
function fakeApi(initial: Note[] = []) {
  let notes = [...initial];
  const requests: { method: string; url: string; body?: unknown }[] = [];
  let failNext: number | null = null;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    requests.push({ method, url, body });
    if (failNext !== null) {
      const status = failNext;
      failNext = null;
      return Response.json({ error: "Boom", code: "x" }, { status });
    }
    if (method === "GET") return Response.json({ notes });
    if (method === "POST") {
      const note = {
        ...(body as unknown as Note),
        createdAt: "2026-11-10T12:00:00.000Z",
        updatedAt: "2026-11-10T12:00:00.000Z",
      };
      notes.push(note);
      return Response.json(note, { status: 201 });
    }
    const id = url.split("/").at(-1);
    if (method === "PATCH") {
      notes = notes.map((n) => (n.id === id ? { ...n, ...(body as Partial<Note>) } : n));
      return Response.json(notes.find((n) => n.id === id));
    }
    notes = notes.filter((n) => n.id !== id);
    return new Response(null, { status: 204 });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    failNextWith: (status: number) => {
      failNext = status;
    },
  };
}

describe("http notes store", () => {
  it("loads on first subscribe, then writes optimistically and in order", async () => {
    const api = fakeApi();
    const store = createHttpNotesStore({ fetch: api.fetch });
    expect(store.getMeta().status).toBe("loading");
    store.subscribe(() => {});
    await flush();
    expect(store.getMeta().status).toBe("ready");

    const note = store.add(book, "hello");
    store.update(note.id, { pinned: true });
    // Visible at once, before any response.
    expect(store.getAll()).toMatchObject([{ id: note.id, body: "hello", pinned: true }]);
    await vi.waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    const writes = api.requests.filter((r) => r.method !== "GET");
    expect(writes.map((r) => r.method)).toEqual(["POST", "PATCH"]);
    expect(writes[0]!.body).toMatchObject({ id: note.id, item: book, body: "hello" });
    expect(writes[1]!.url).toBe(`/api/notes/library/b1/${note.id}`);
    expect(writes[1]!.body).toEqual({ pinned: true });
    // The optimistic note survives the first load, which answered before the writes landed.
    await vi.waitFor(() => expect(store.getAll()).toMatchObject([{ id: note.id, pinned: true }]));
  });

  it("sends expectedUpdatedAt with a text edit", async () => {
    const api = fakeApi();
    const store = createHttpNotesStore({ fetch: api.fetch });
    store.subscribe(() => {});
    const note = store.add(book, "a");
    // Wait for the server's copy (exact timestamps) to replace the optimistic one.
    await vi.waitFor(() => expect(store.getAll()[0]?.updatedAt).toBe("2026-11-10T12:00:00.000Z"));
    store.update(note.id, { body: "b" });
    await vi.waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(api.requests.find((r) => r.method === "PATCH")!.body).toEqual({
      body: "b",
      expectedUpdatedAt: "2026-11-10T12:00:00.000Z",
    });
  });

  it("on a failed write reports the error and reloads the server's copy", async () => {
    const api = fakeApi();
    const store = createHttpNotesStore({ fetch: api.fetch });
    store.subscribe(() => {});
    await flush();
    api.failNextWith(422);
    store.add(book, "rejected");
    expect(store.getAll()).toHaveLength(1);
    await vi.waitFor(() => expect(store.getMeta().error).toBe("Nota non salvata: Boom"));
    await vi.waitFor(() => expect(store.getAll()).toHaveLength(0));
    // The refused text is kept for the composer.
    expect(store.getMeta().rejectedDraft).toMatchObject({
      itemKey: "library:b1",
      body: "rejected",
    });
    store.dismissError();
    expect(store.getMeta()).toMatchObject({ error: null, rejectedDraft: null });
  });

  it("reports a failed first load", async () => {
    const api = fakeApi();
    api.failNextWith(500);
    const store = createHttpNotesStore({ fetch: api.fetch });
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getMeta().status).toBe("error"));
    expect(store.getMeta().error).toContain("Impossibile caricare le note");
    store.reload();
    await vi.waitFor(() => expect(store.getMeta()).toMatchObject({ status: "ready", error: null }));
  });
});

describe("note search", () => {
  it("matches every word, ignoring case and accents, across fields", () => {
    const tokens = searchTokens("  Perche  STOICI ");
    expect(tokens).toEqual(["perche", "stoici"]);
    expect(matchesTokens(tokens, "Perché leggere", "Gli stoici")).toBe(true);
    expect(matchesTokens(tokens, "Perché leggere")).toBe(false);
    expect(matchesTokens([], "anything")).toBe(true);
  });
});
