// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ThemeProvider } from "@ehub/ui";
import { ExplorationPage } from "../../src/web/exploration-page.tsx";
import { createMemoryExploreStore } from "../../src/web/store.ts";
import { EXPLORATION_ID, sampleExploration } from "./fixtures.ts";

const EXPLORE_BOOK = "k3m9x2pq";

afterEach(cleanup);

/** The dev toolbar (rendered with devTools) needs the theme of the app. */
function renderDetail(store: ReturnType<typeof createMemoryExploreStore>, devTools = true) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/explore/${EXPLORATION_ID}`]}>
        <Routes>
          <Route path="/explore/:id" element={<ExplorationPage store={store} devTools={devTools} />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("summary status under the sources (local dev)", () => {
  it("shows the progress of a running summary, with the chapters done out of the total", async () => {
    const store = createMemoryExploreStore([sampleExploration()], {
      summaries: { [EXPLORE_BOOK]: { state: "running", done: 2, total: 5 } },
    });
    renderDetail(store);

    expect(await screen.findByText("Sintesi in corso · 2/5 capitoli")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Avanzamento della sintesi" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
  });

  it("shows an indeterminate line while the total of chapters is unknown", async () => {
    const store = createMemoryExploreStore([sampleExploration()], {
      summaries: { [EXPLORE_BOOK]: { state: "running", done: 0 } },
    });
    renderDetail(store);

    expect(await screen.findByText("Sintesi in corso…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  });

  it("shows «Sintesi pronta» with a check when the summary is done", async () => {
    const store = createMemoryExploreStore([sampleExploration()], {
      summaries: { [EXPLORE_BOOK]: { state: "done" } },
    });
    renderDetail(store);

    expect(await screen.findByText("Sintesi pronta")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the error of a failed summary and retries it on «Riprova»", async () => {
    const store = createMemoryExploreStore([sampleExploration()], {
      summaries: { [EXPLORE_BOOK]: { state: "failed", error: "Il modello non risponde." } },
    });
    renderDetail(store);

    const failed = await screen.findByText("Sintesi non riuscita");
    expect(failed.getAttribute("title")).toBe("Il modello non risponde.");

    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    // The retry sets the book to running and the status is read again: the progress line comes back.
    expect(await screen.findByText("Sintesi in corso…")).toBeTruthy();
    expect(screen.queryByText("Sintesi non riuscita")).toBeNull();
  });

  it("shows nothing outside devTools, even when the summaries are running or done", async () => {
    const store = createMemoryExploreStore([sampleExploration()], {
      summaries: { [EXPLORE_BOOK]: { state: "running", done: 1, total: 4 } },
    });
    renderDetail(store, false);
    await screen.findByRole("heading", { name: "Nietzsche e la morale cristiana" });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Sintesi in corso/)).toBeNull();
  });

  it("shows nothing for a library book without a summary", async () => {
    renderDetail(createMemoryExploreStore([sampleExploration()]));
    await screen.findByRole("heading", { name: "Nietzsche e la morale cristiana" });
    expect(screen.queryByText("Sintesi pronta")).toBeNull();
    expect(screen.queryByText(/Sintesi in corso/)).toBeNull();
    expect(screen.queryByText("Sintesi non riuscita")).toBeNull();
  });
});
