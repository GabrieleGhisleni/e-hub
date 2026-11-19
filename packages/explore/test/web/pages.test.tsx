// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ExplorationPage } from "../../src/web/exploration-page.tsx";
import { ExplorationListPage } from "../../src/web/exploration-list-page.tsx";
import { createMemoryExploreStore } from "../../src/web/store.ts";
import { EXPLORATION_ID, otherExploration, sampleExploration } from "./fixtures.ts";

afterEach(cleanup);

describe("exploration list (read-only)", () => {
  it("lists explorations with their verdicts and no write actions", () => {
    const store = createMemoryExploreStore([sampleExploration(), otherExploration()]);
    render(
      <MemoryRouter>
        <ExplorationListPage store={store} devTools={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Nietzsche e la morale cristiana" })).toBeTruthy();
    expect(screen.getByText("Che cosa dice Nietzsche della morale cristiana, e dove?")).toBeTruthy();
    expect(screen.getByText(/Leggere i capitoli 2 e 5/)).toBeTruthy();
    expect(screen.getByText(/Leggere tutto/)).toBeTruthy();
    expect(screen.queryByText("Nuova esplorazione")).toBeNull();
  });

  it("shows the tags and filters the list by tag", () => {
    const store = createMemoryExploreStore([
      sampleExploration({ tags: ["filosofia"] }),
      otherExploration(),
    ]);
    render(
      <MemoryRouter>
        <ExplorationListPage store={store} devTools={false} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("filosofia").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "filosofia" }));
    expect(screen.getByRole("heading", { name: "Nietzsche e la morale cristiana" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: otherExploration().title })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi filtro: filosofia" }));
    expect(screen.getByRole("heading", { name: otherExploration().title })).toBeTruthy();
  });

  it("uses the first book cover and combines the state filter with a search by source", () => {
    const first = sampleExploration();
    const store = createMemoryExploreStore([first, { ...otherExploration(), status: "closed" }]);
    render(
      <MemoryRouter>
        <ExplorationListPage
          store={store}
          devTools={false}
          cover={({ source }) => <img alt={`Copertina di ${source.title}`} />}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("img", { name: `Copertina di ${first.sources[0].title}` })).toHaveLength(2);
    expect(screen.queryByRole("img", { name: `Copertina di ${first.sources[1].title}` })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cerca nelle esplorazioni" }), {
      target: { value: first.sources[1].title },
    });
    expect(screen.getByRole("heading", { name: first.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: otherExploration().title })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chiusa" }));
    expect(screen.getByText("Nessuna esplorazione trovata")).toBeTruthy();
  });

  it("shows the empty state when there are no explorations", () => {
    const store = createMemoryExploreStore([]);
    render(
      <MemoryRouter>
        <ExplorationListPage store={store} devTools={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nessuna esplorazione ancora")).toBeTruthy();
  });
});

function renderDetail(store: ReturnType<typeof createMemoryExploreStore>, devTools = false) {
  return render(
    <MemoryRouter initialEntries={[`/explore/${EXPLORATION_ID}`]}>
      <Routes>
        <Route
          path="/explore/:id"
          element={<ExplorationPage store={store} devTools={devTools} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("exploration detail (read-only)", () => {
  it("shows the question, the sources with their verdicts and the library link", async () => {
    renderDetail(createMemoryExploreStore([sampleExploration()]));

    expect(await screen.findByRole("heading", { name: "Nietzsche e la morale cristiana" })).toBeTruthy();
    expect(screen.getByText("Leggere i capitoli 2 e 5")).toBeTruthy();
    expect(screen.getByText("Due capitoli sulla morale.")).toBeTruthy();
    expect(screen.getByText("Da decidere")).toBeTruthy();
    expect(screen.getByText(/Solo da esplorare/)).toBeTruthy();

    const link = screen.getByRole("link", { name: /Apri la pagina del libro/ });
    expect(link.getAttribute("href")).toBe("/library/book/eec5cpre");
    expect(screen.getByText("Nessuna sintesi ancora.")).toBeTruthy();
  });

  it("has no chat or edit controls when devTools is off", async () => {
    renderDetail(createMemoryExploreStore([sampleExploration()]), false);
    await screen.findByRole("heading", { name: "Nietzsche e la morale cristiana" });
    expect(screen.queryByRole("button", { name: /Chatta/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifica verdetto/ })).toBeNull();
  });

  it("shows the notebook between the sources and the summary, as Markdown", async () => {
    const exploration = sampleExploration({
      notebook: { body: "## Appunti\n\nUna **prova** sul quaderno.", updatedAt: "2026-11-13T10:00:00.000Z", via: "skill" },
    });
    renderDetail(createMemoryExploreStore([exploration]));

    await screen.findByRole("heading", { name: "Quaderno" });
    expect(screen.getByRole("heading", { name: "Appunti" })).toBeTruthy();
    expect(screen.getByText("prova").tagName).toBe("STRONG");
    expect(screen.getByText(/Aggiornato il 13 novembre 2026/)).toBeTruthy();
    expect(screen.getByText(/Dalla skill/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Modifica/ })).toBeNull();

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Fonti")).toBeLessThan(headings.indexOf("Quaderno"));
    expect(headings.indexOf("Quaderno")).toBeLessThan(headings.indexOf("Sintesi"));
  });

  it("says the notebook is empty when there is none", async () => {
    renderDetail(createMemoryExploreStore([sampleExploration()]));
    await screen.findByRole("heading", { name: "Quaderno" });
    expect(screen.getByText("Il quaderno è vuoto.")).toBeTruthy();
    expect(screen.queryByText(/Scrivilo qui/)).toBeNull();
  });

  it("says so when the exploration does not exist", async () => {
    renderDetail(createMemoryExploreStore([]));
    expect(await screen.findByText("Esplorazione non trovata")).toBeTruthy();
  });
});
