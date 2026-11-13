// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalCard } from "../../src/web/dev/dev-tools.tsx";
import { parseChapterText, readProposal } from "../../src/web/proposal-input.ts";
import { createMemoryExploreStore } from "../../src/web/store.ts";
import { EXPLORATION_ID, sampleExploration } from "./fixtures.ts";

afterEach(cleanup);

const part = (input: unknown, state = "output-available") => ({
  toolName: "propose_verdicts",
  toolCallId: "call-1",
  state,
  input,
  output: null,
});

const proposal = {
  verdicts: [
    { book: "eec5cpre", decision: "parts", chapters: [5, 2], reason: "I capitoli sulla morale." },
    { book: "k3m9x2pq", decision: "skip", reason: "Non serve alla domanda." },
  ],
  summary: "Sintesi di prova.",
  journal: "Diario di prova.",
};

describe("proposal card", () => {
  it("writes nothing until confirmed, and then only the checked items", async () => {
    const store = createMemoryExploreStore([sampleExploration()]);
    const setVerdict = vi.spyOn(store, "setVerdict");
    const update = vi.spyOn(store, "update");
    const addJournal = vi.spyOn(store, "addJournal");
    render(
      <ProposalCard
        exploration={sampleExploration()}
        part={part(proposal)}
        store={store}
      />,
    );

    expect(screen.getByText("Genealogia della morale")).toBeTruthy();
    expect(setVerdict).not.toHaveBeenCalled();

    // Leave the second verdict out, keep the summary, drop the journal.
    fireEvent.click(screen.getByRole("checkbox", { name: "Includi Genealogia della morale" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Includi diario" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma e salva" }));

    await waitFor(() => expect(screen.getByText("Salvato")).toBeTruthy());
    expect(setVerdict).toHaveBeenCalledTimes(1);
    expect(setVerdict).toHaveBeenCalledWith(EXPLORATION_ID, "eec5cpre", {
      decision: "parts",
      chapters: [2, 5],
      reason: "I capitoli sulla morale.",
    });
    expect(update).toHaveBeenCalledWith(EXPLORATION_ID, { summary: "Sintesi di prova." });
    expect(addJournal).not.toHaveBeenCalled();
  });

  it("shows a short notice when the tool input is not valid", () => {
    render(
      <ProposalCard
        exploration={sampleExploration()}
        part={part({ verdicts: [] })}
        store={createMemoryExploreStore([sampleExploration()])}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Non riesco a mostrare la proposta/);
    expect(screen.queryByRole("button", { name: "Conferma e salva" })).toBeNull();
  });

  it("refuses a book that is not a source of the exploration", () => {
    render(
      <ProposalCard
        exploration={sampleExploration()}
        part={part({ verdicts: [{ book: "78w462eb", decision: "all", reason: "Ok." }] })}
        store={createMemoryExploreStore([sampleExploration()])}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/non è una fonte di questa esplorazione/);
  });
});

describe("proposal input", () => {
  const sources = sampleExploration().sources.map((s) => ({ id: s.id, title: s.title }));

  it("accepts a valid proposal", () => {
    expect(readProposal(proposal, sources).ok).toBe(true);
  });

  it("rejects unknown decisions, parts without chapters and chapters with another decision", () => {
    expect(
      readProposal({ verdicts: [{ book: "eec5cpre", decision: "maybe", reason: "x" }] }, sources).ok,
    ).toBe(false);
    expect(
      readProposal({ verdicts: [{ book: "eec5cpre", decision: "parts", reason: "x" }] }, sources).ok,
    ).toBe(false);
    expect(
      readProposal({ verdicts: [{ book: "k3m9x2pq", decision: "all", chapters: [1], reason: "x" }] }, sources)
        .ok,
    ).toBe(false);
  });

  it("rejects a book that is not a source", () => {
    const result = readProposal({ verdicts: [{ book: "78w462eb", decision: "all", reason: "x" }] }, sources);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/non è una fonte/);
  });

  it("reads chapter numbers typed by the user", () => {
    expect(parseChapterText("2, 5")).toEqual([2, 5]);
    expect(parseChapterText("5 2 5")).toEqual([2, 5]);
    expect(parseChapterText("due")).toBeUndefined();
    expect(parseChapterText("")).toBeUndefined();
  });
});
