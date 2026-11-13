import { describe, expect, it, vi } from "vitest";
import { EXPLORATION_ID, sampleExploration } from "./fixtures.ts";
import {
  ExploreApiError,
  createHttpExploreStore,
  createStaticExploreStore,
  isExploration,
} from "../../src/web/store.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("http explore store", () => {
  it("loads the list on first subscription and keeps it newest first", async () => {
    const older = sampleExploration({ id: "2026-11-01-a", createdAt: "2026-11-01T10:00:00.000Z" });
    const newer = sampleExploration();
    const fetch = vi.fn(async () => json({ explorations: [older, newer] }));
    const store = createHttpExploreStore({ fetch: fetch as unknown as typeof globalThis.fetch });

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await vi.waitFor(() => expect(store.getMeta().status).toBe("ready"));
    unsubscribe();

    expect(fetch).toHaveBeenCalledWith("/api/explore", expect.anything());
    expect(store.getAll().map((e) => e.id)).toEqual([EXPLORATION_ID, "2026-11-01-a"]);
    expect(listener).toHaveBeenCalled();
  });

  it("replaces the cached copy with the server's answer and sends the verdict as JSON", async () => {
    const before = sampleExploration();
    const after = sampleExploration({ updatedAt: "2026-11-12T19:00:00.000Z" });
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(before));
    const store = createHttpExploreStore({ fetch: fetch as unknown as typeof globalThis.fetch });
    await store.fetchOne(EXPLORATION_ID);
    fetch.mockImplementationOnce(async () => json(after));

    const result = await store.setVerdict(EXPLORATION_ID, "k3m9x2pq", {
      decision: "skip",
      reason: "Non serve alla domanda.",
    });

    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/explore/${EXPLORATION_ID}/verdicts/k3m9x2pq`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      decision: "skip",
      reason: "Non serve alla domanda.",
    });
    expect(result.updatedAt).toBe("2026-11-12T19:00:00.000Z");
    expect(store.get(EXPLORATION_ID)?.updatedAt).toBe("2026-11-12T19:00:00.000Z");
  });

  it("turns the server's error body into the message to show", async () => {
    const fetch = vi.fn(async () => json({ error: "Esplorazione non trovata.", code: "not-found" }, 404));
    const store = createHttpExploreStore({ fetch: fetch as unknown as typeof globalThis.fetch });
    const error = await store.fetchOne("2026-11-12-x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExploreApiError);
    expect((error as ExploreApiError).message).toBe("Esplorazione non trovata.");
    expect((error as ExploreApiError).status).toBe(404);
  });

  it("uploads an EPUB as the raw body with the encoded file name", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(sampleExploration()));
    const store = createHttpExploreStore({ fetch: fetch as unknown as typeof globalThis.fetch });
    const file = new File(["PK"], "Genealogia è.epub", { type: "application/epub+zip" });

    await store.uploadEpub(EXPLORATION_ID, file);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/explore/${EXPLORATION_ID}/epub`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(file);
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/epub+zip");
    expect(headers["x-file-name"]).toBe(encodeURIComponent("Genealogia è.epub"));
  });

  it("reports a failed list load in meta", async () => {
    const fetch = vi.fn(async () => new Response("boom", { status: 500 }));
    const store = createHttpExploreStore({ fetch: fetch as unknown as typeof globalThis.fetch });
    await store.reload();
    expect(store.getMeta().status).toBe("error");
    expect(store.getMeta().error).toMatch(/Impossibile caricare le esplorazioni/);
  });
});

describe("static explore store", () => {
  it("serves the bundled explorations read-only and rejects writes", async () => {
    const store = createStaticExploreStore([sampleExploration(), { not: "an exploration" }]);
    expect(store.getMeta()).toMatchObject({ status: "ready", readOnly: true });
    expect(store.getAll()).toHaveLength(1);
    await expect(store.fetchOne(EXPLORATION_ID)).resolves.toMatchObject({ id: EXPLORATION_ID });
    await expect(store.fetchOne("2026-11-12-missing")).rejects.toMatchObject({ status: 404 });
    await expect(store.addJournal(EXPLORATION_ID, "x")).rejects.toThrow(/sola lettura/);
  });

  it("recognises explorations by shape", () => {
    expect(isExploration(sampleExploration())).toBe(true);
    expect(isExploration({ version: 2 })).toBe(false);
    expect(isExploration(null)).toBe(false);
  });
});
