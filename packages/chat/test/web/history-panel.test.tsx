// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatPanel } from "../../src/web/chat-panel.tsx";
import { historyKey, saveConversation } from "../../src/web/history.ts";
import type { ChatUIMessage } from "../../src/shared/types.ts";

const source = { kind: "episode", id: "alpha" } as const;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatPanel history", () => {
  it("restores the most recent saved conversation when the panel opens", async () => {
    const older: ChatUIMessage[] = [
      { id: "o1", role: "user", parts: [{ type: "text", text: "Domanda vecchia" }] },
      { id: "o2", role: "assistant", parts: [{ type: "text", text: "Risposta vecchia" }] },
    ];
    const latest: ChatUIMessage[] = [
      { id: "l1", role: "user", parts: [{ type: "text", text: "Domanda recente" }] },
      { id: "l2", role: "assistant", parts: [{ type: "text", text: "Risposta recente" }] },
    ];
    saveConversation(source, { id: "old", messages: older }, new Date(2026, 0, 1));
    saveConversation(source, { id: "new", messages: latest }, new Date(2026, 0, 2));

    render(<ChatPanel source={source} title="Episodio alfa" open onOpenChange={() => {}} />);

    expect(await screen.findByText("Domanda recente")).toBeTruthy();
    expect(screen.getByText("Risposta recente")).toBeTruthy();
    expect(screen.queryByText("Domanda vecchia")).toBeNull();
    expect(screen.queryByRole("button", { name: /Invia/ })).toBeTruthy();
  });

  it("starts empty when there is no saved conversation for the source", () => {
    window.localStorage.setItem(historyKey({ kind: "book", id: "other" }), "[]");
    render(
      <ChatPanel source={source} title="Episodio alfa" suggestions={["Domanda uno"]} open onOpenChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Domanda uno" })).toBeTruthy();
  });
});
