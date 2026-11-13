// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotebookProposalCard } from "../../src/web/dev/notebook-proposal.tsx";
import { createMemoryExploreStore } from "../../src/web/store.ts";
import { EXPLORATION_ID, sampleExploration } from "./fixtures.ts";

afterEach(cleanup);

const part = (input: unknown, state = "output-available") => ({
  toolName: "propose_notebook",
  toolCallId: "call-1",
  state,
  input,
  output: null,
});

const proposed = "**Tesi**\n\nIl ressentimento è il filo rosso.";

describe("notebook proposal card", () => {
  it("shows the preparing line while the input streams", () => {
    render(
      <NotebookProposalCard
        exploration={sampleExploration()}
        part={part(undefined, "input-streaming")}
        store={createMemoryExploreStore([sampleExploration()])}
      />,
    );
    expect(screen.getByText("Preparo la proposta…")).toBeTruthy();
  });

  it("prefills the text, says what it replaces, and writes nothing until a button is clicked", () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    const setNotebook = vi.spyOn(store, "setNotebook");
    const appendNotebook = vi.spyOn(store, "appendNotebook");
    render(<NotebookProposalCard exploration={sampleExploration()} part={part({ body: proposed })} store={store} />);

    expect((screen.getByRole("textbox", { name: "Testo del quaderno proposto" }) as HTMLTextAreaElement).value).toBe(
      proposed,
    );
    expect(screen.getByText(/Sostituisce l'intero quaderno \(ora vuoto\)/)).toBeTruthy();
    expect(setNotebook).not.toHaveBeenCalled();
    expect(appendNotebook).not.toHaveBeenCalled();
  });

  it("stops saying how much it replaces once the card is saved", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    render(<NotebookProposalCard exploration={sampleExploration()} part={part({ body: proposed })} store={store} />);
    expect(screen.getByText(/Sostituisce l'intero quaderno/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi in fondo" }));

    await waitFor(() => expect(screen.getByText("Salvato")).toBeTruthy());
    expect(screen.queryByText(/Sostituisce l'intero quaderno/)).toBeNull();
  });

  it("replaces the whole notebook with the edited text when asked", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    const setNotebook = vi.spyOn(store, "setNotebook");
    render(<NotebookProposalCard exploration={sampleExploration()} part={part({ body: proposed })} store={store} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Testo del quaderno proposto" }), {
      target: { value: "Testo corretto." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sostituisci il quaderno" }));

    await waitFor(() => expect(screen.getByText("Salvato")).toBeTruthy());
    expect(setNotebook).toHaveBeenCalledWith(EXPLORATION_ID, "Testo corretto.");
    expect(screen.queryByRole("button", { name: "Sostituisci il quaderno" })).toBeNull();
  });

  it("appends the text when asked to add it at the end", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    const appendNotebook = vi.spyOn(store, "appendNotebook");
    const setNotebook = vi.spyOn(store, "setNotebook");
    render(<NotebookProposalCard exploration={sampleExploration()} part={part({ body: proposed })} store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi in fondo" }));

    await waitFor(() => expect(screen.getByText("Salvato")).toBeTruthy());
    expect(appendNotebook).toHaveBeenCalledWith(EXPLORATION_ID, proposed);
    expect(setNotebook).not.toHaveBeenCalled();
  });

  it("keeps the buttons off when the text is emptied, so the notebook is not cleared by accident", () => {
    render(
      <NotebookProposalCard
        exploration={sampleExploration()}
        part={part({ body: proposed })}
        store={createMemoryExploreStore([sampleExploration()])}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Testo del quaderno proposto" }), {
      target: { value: "   " },
    });
    expect((screen.getByRole("button", { name: "Sostituisci il quaderno" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a short notice, and no buttons, when the tool input is not valid", () => {
    render(
      <NotebookProposalCard
        exploration={sampleExploration()}
        part={part({ body: "   " })}
        store={createMemoryExploreStore([sampleExploration()])}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Non riesco a mostrare la proposta del quaderno/);
    expect(screen.queryByRole("button", { name: "Sostituisci il quaderno" })).toBeNull();
  });
});
