// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotebookDevEditor } from "../../src/web/dev/notebook-editor.tsx";
import { useExploration, createMemoryExploreStore, type ExploreStore } from "../../src/web/store.ts";
import { EXPLORATION_ID, sampleExploration } from "./fixtures.ts";

afterEach(cleanup);

/** The editor, fed by the store the way the page feeds it. */
function Harness({ store }: { store: ExploreStore }) {
  const exploration = useExploration(EXPLORATION_ID, store);
  return exploration ? <NotebookDevEditor exploration={exploration} store={store} /> : null;
}

function bodyOf(store: ExploreStore) {
  return store.getAll().find((e) => e.id === EXPLORATION_ID)?.notebook;
}

describe("notebook editor (dev only)", () => {
  it("saves the edited Markdown through the store", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: /Modifica/ }));
    const textarea = screen.getByLabelText("Quaderno (Markdown)") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    fireEvent.change(textarea, { target: { value: "# Titolo\n\nPrima riga" } });
    expect(screen.getByText(/^\d+ \/ 100000/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    });

    expect(bodyOf(store)?.body).toBe("# Titolo\n\nPrima riga");
    expect(bodyOf(store)?.via).toBe("app");
    expect(screen.getByRole("heading", { name: "Titolo" })).toBeTruthy();
    expect(screen.queryByLabelText("Quaderno (Markdown)")).toBeNull();
  });

  it("clears the notebook after confirmation", async () => {
    const store = createMemoryExploreStore([
      sampleExploration({ notebook: { body: "Appunti", updatedAt: "2026-11-13T10:00:00.000Z", via: "cli" } }),
    ]);
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: /Svuota/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Svuota quaderno" }));
    });

    expect(bodyOf(store)).toBeUndefined();
    expect(screen.getByText(/Il quaderno è vuoto\./)).toBeTruthy();
    expect(screen.getByText(/Scrivilo qui o aggiungi risposte dalla chat\./)).toBeTruthy();
  });

  it("does not show the clear action on an empty notebook", () => {
    render(<Harness store={createMemoryExploreStore([sampleExploration()])} />);
    expect(screen.queryByRole("button", { name: /Svuota/ })).toBeNull();
  });

  it("shows a chat append in view mode, but keeps the draft while editing and warns", async () => {
    const store = createMemoryExploreStore([
      sampleExploration({ notebook: { body: "Versione uno", updatedAt: "2026-11-13T10:00:00.000Z", via: "app" } }),
    ]);
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: /Modifica/ }));
    fireEvent.change(screen.getByLabelText("Quaderno (Markdown)"), { target: { value: "Bozza mia" } });

    await act(async () => {
      await store.appendNotebook(EXPLORATION_ID, "Risposta dalla chat");
    });

    const textarea = screen.getByLabelText("Quaderno (Markdown)") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Bozza mia");
    expect(screen.getByText(/Il quaderno è cambiato mentre lo modificavi/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.getByText(/Risposta dalla chat/)).toBeTruthy();
    expect(screen.queryByText(/cambiato mentre/)).toBeNull();
  });

  it("cancels with Escape and saves with Ctrl+Enter", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: /Modifica/ }));
    const textarea = screen.getByLabelText("Quaderno (Markdown)");
    fireEvent.change(textarea, { target: { value: "Non salvato" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByLabelText("Quaderno (Markdown)")).toBeNull();
    expect(bodyOf(store)).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /Modifica/ }));
    fireEvent.change(screen.getByLabelText("Quaderno (Markdown)"), { target: { value: "Salvato da tastiera" } });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Quaderno (Markdown)"), { key: "Enter", ctrlKey: true });
    });
    expect(bodyOf(store)?.body).toBe("Salvato da tastiera");
  });
});
