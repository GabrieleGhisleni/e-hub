// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEpisode, makeShow, makeSiteData } from "@podcasts/testing/fixtures";
import { SiteDataProvider } from "@podcasts/site-data";
import { cleanTag } from "./chip-input";
import { conversationOutcome } from "./conversation-dialog";
import { clearDraft, loadDraft, saveDraft, startingState, valuesOf } from "./drafts";
import { EpisodeEditorDialog } from "./episode-editor";
import { api } from "./api";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

const episode = makeEpisode({
  slug: "alpha-sleep",
  updatedAt: "2026-02-01T00:00:00.000Z",
  notes: "Saved notes",
  tags: ["sleep"],
  summary: ["One", "Two"],
  guests: ["Ada"],
});

describe("drafts", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips and clears", () => {
    const draft = {
      ...valuesOf(episode),
      notes: "typed",
      baseUpdatedAt: episode.updatedAt,
      base: valuesOf(episode),
    };
    saveDraft("alpha-sleep", draft);
    expect(loadDraft("alpha-sleep")).toEqual(draft);
    clearDraft("alpha-sleep");
    expect(loadDraft("alpha-sleep")).toBeUndefined();
  });

  it("ignores corrupt drafts and survives unavailable storage", () => {
    window.sessionStorage.setItem("e-podcasts-dev:draft:alpha-sleep", "{nope");
    expect(loadDraft("alpha-sleep")).toBeUndefined();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDraft("alpha-sleep")).toBeUndefined();
    expect(() => saveDraft("alpha-sleep", startingState(episode, undefined))).not.toThrow();
    vi.restoreAllMocks();
  });

  it("merges a stale draft: touched fields stay, untouched ones follow the new version", () => {
    const old = makeEpisode({
      ...episode,
      updatedAt: "2026-01-01T00:00:00.000Z",
      summary: ["Old"],
      tags: [],
    });
    const draft = {
      ...valuesOf(old),
      notes: "my draft notes",
      baseUpdatedAt: old.updatedAt,
      base: valuesOf(old),
    };
    const state = startingState(episode, draft);
    expect(state.notes).toBe("my draft notes"); // touched
    expect(state.summary).toBe("One\nTwo"); // untouched: current version
    expect(state.tags).toEqual(["sleep"]);
    expect(state.baseUpdatedAt).toBe(old.updatedAt); // still marked stale
  });
});

describe("helpers", () => {
  it("cleans tags to lowercase english slugs", () => {
    expect(cleanTag("Sleep Quality")).toBe("sleep-quality");
    expect(cleanTag("C++")).toBe("c");
    expect(cleanTag("  AI_safety")).toBe("ai-safety");
  });

  it("reports removed excerpts after adding a conversation", () => {
    expect(conversationOutcome({ added: 1, skipped: 0, excerptsRemoved: 2 }).description).toMatch(
      /2 estratti/,
    );
    expect(conversationOutcome({ added: 0, skipped: 1, excerptsRemoved: 0 }).kind).toBe("info");
  });
});

describe("EpisodeEditorDialog", () => {
  const renderEditor = () =>
    render(
      <SiteDataProvider data={makeSiteData([makeShow({ slug: "alpha" })], [episode])}>
        <EpisodeEditorDialog episode={episode} open onOpenChange={() => {}} />
      </SiteDataProvider>,
    );

  it("keeps the typed text and says so on a 409", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "modified in the meantime", code: "conflict", actualUpdatedAt: "2026-03-01" },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const notes = screen.getByLabelText(/Appunti/);
    fireEvent.change(notes, { target: { value: "my precious notes" } });
    // The draft is mirrored while typing.
    expect(loadDraft("alpha-sleep")?.notes).toBe("my precious notes");

    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByText("Conflitto di versione")).toBeInTheDocument();
    expect(screen.getByText(/modificato altrove/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ricarica la versione aggiornata/ }),
    ).toBeInTheDocument();
    expect(notes).toHaveValue("my precious notes");
    expect(loadDraft("alpha-sleep")?.notes).toBe("my precious notes");

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/podcasts/episodes/alpha-sleep");
    expect(JSON.parse(init.body as string)).toMatchObject({
      expectedUpdatedAt: episode.updatedAt,
      notes: "my precious notes",
      summary: ["One", "Two"],
    });
  });

  it("re-merges when the episode changes under the open editor (save from the CLI)", () => {
    const { rerender } = renderEditor();
    fireEvent.change(screen.getByLabelText(/Appunti/), { target: { value: "typed while away" } });
    const updated = {
      ...episode,
      updatedAt: "2026-02-02T00:00:00.000Z",
      summary: ["Changed elsewhere"],
    };
    rerender(
      <SiteDataProvider data={makeSiteData([makeShow({ slug: "alpha" })], [updated])}>
        <EpisodeEditorDialog episode={updated} open onOpenChange={() => {}} />
      </SiteDataProvider>,
    );
    expect(screen.getByLabelText(/Appunti/)).toHaveValue("typed while away");
    expect(screen.getByLabelText(/In breve/)).toHaveValue("Changed elsewhere");
    expect(screen.getByText("Bozza basata su una versione precedente")).toBeInTheDocument();
  });

  it("keeps guest descriptions in the draft and submits them with the episode", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        written: true,
        updatedAt: "2026-03-01",
        changedFields: ["guestDescriptions"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    fireEvent.change(screen.getByLabelText("Presentazione di Ada"), {
      target: { value: " Studia informatica. " },
    });
    expect(loadDraft("alpha-sleep")?.guestDescriptions).toEqual({ Ada: " Studia informatica. " });

    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(loadDraft("alpha-sleep")).toBeUndefined());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).guestDescriptions).toEqual({
      Ada: "Studia informatica.",
    });
  });

  it("clears the draft after a successful save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ written: true, updatedAt: "2026-03-01", changedFields: ["notes"] }),
      ),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText(/Appunti/), { target: { value: "Saved notes more" } });
    expect(loadDraft("alpha-sleep")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(loadDraft("alpha-sleep")).toBeUndefined());
  });

  it("shows server validation messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "invalid", code: "transcript-guard", details: ["notes: 25 consecutive words"] },
          { status: 422 },
        ),
      ),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText(/Appunti/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByText(/25 consecutive words/)).toBeInTheDocument();
  });
});

describe("api.remove", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a JSON content type, which the local write guard requires", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ slug: "a", title: "A" })));
    vi.stubGlobal("fetch", fetchMock);
    await api.remove("a");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/podcasts/episodes/a");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});
