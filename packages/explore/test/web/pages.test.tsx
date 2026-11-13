// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

  it("says so when the exploration does not exist", async () => {
    renderDetail(createMemoryExploreStore([]));
    expect(await screen.findByText("Esplorazione non trovata")).toBeTruthy();
  });
});
