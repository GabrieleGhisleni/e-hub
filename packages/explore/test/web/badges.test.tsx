// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { SourceExtras, SourceExtrasProvider } from "@ehub/ui";
import { ExplorationBadges } from "../../src/web/exploration-badges.tsx";
import { createMemoryExploreStore } from "../../src/web/store.ts";
import { otherExploration, sampleExploration } from "./fixtures.ts";

afterEach(cleanup);

describe("exploration badges", () => {
  it("shows one line per exploration that uses the book, with the verdict there", () => {
    const store = createMemoryExploreStore([sampleExploration(), otherExploration()]);
    render(
      <MemoryRouter>
        <ExplorationBadges bookId="eec5cpre" store={store} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Esplorato in: «Nietzsche e la morale cristiana» — Leggere i capitoli 2 e 5"),
    ).toBeTruthy();
    expect(screen.getByText("Esplorato in: «Zarathustra in breve» — Leggere tutto")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Nietzsche e la morale cristiana/ });
    expect(link.getAttribute("href")).toBe("/explore/2026-11-12-nietzsche-e-la-morale-cristiana");
  });

  it("renders nothing for a book that is in no exploration", () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    const { container } = render(
      <MemoryRouter>
        <ExplorationBadges bookId="78w462eb" store={store} />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("SourceExtras", () => {
  it("renders what the provider returns for the reference", () => {
    render(
      <SourceExtrasProvider render={(ref) => `${ref.kind}:${ref.id}`}>
        <SourceExtras kind="book" id="eec5cpre" />
      </SourceExtrasProvider>,
    );
    expect(screen.getByText("book:eec5cpre")).toBeTruthy();
  });

  it("renders nothing without a provider", () => {
    const { container } = render(<SourceExtras kind="book" id="eec5cpre" />);
    expect(container.innerHTML).toBe("");
  });
});
