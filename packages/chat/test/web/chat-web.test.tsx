// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel, describeChatError } from "../../src/web/chat-panel.tsx";
import { DEFAULT_SUGGESTIONS, MessageList } from "../../src/web/message-list.tsx";
import type { ChatUIMessage } from "../../src/shared/types.ts";

afterEach(cleanup);

const userMessage = (id: string, text: string): ChatUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistantMessage = (
  id: string,
  metadata: ChatUIMessage["metadata"],
  text = "Risposta di prova",
): ChatUIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
  metadata,
});

describe("MessageList", () => {
  it("shows the empty state with suggestions and reports the clicked one", () => {
    const onSuggestion = vi.fn();
    render(<MessageList messages={[]} onSuggestion={onSuggestion} />);

    for (const suggestion of DEFAULT_SUGGESTIONS) {
      expect(screen.getByRole("button", { name: suggestion })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_SUGGESTIONS[0] ?? "" }));
    expect(onSuggestion).toHaveBeenCalledWith(DEFAULT_SUGGESTIONS[0]);
  });

  it("renders messages with the model line, the tier warning and the token count", () => {
    const messages: ChatUIMessage[] = [
      userMessage("u1", "Di cosa parla?"),
      assistantMessage("a1", { model: "gemini-3.6-flash", provider: "google", tier: "smart", totalTokens: 1234 }),
      assistantMessage("a2", { model: "some-model", provider: "acme", tier: "balanced" }, "Risposta declassata"),
    ];
    render(<MessageList messages={messages} renderMarkdown={(text) => <strong>{text}</strong>} />);

    expect(screen.getByText("Di cosa parla?")).toBeTruthy();
    expect(screen.getByText("Risposta di prova").tagName).toBe("STRONG");
    expect(screen.getByText("gemini-3.6-flash · google")).toBeTruthy();
    expect(screen.getByText("1234 token")).toBeTruthy();
    expect(screen.getByText("some-model · acme")).toBeTruthy();
    // Only a tier other than "smart" is a downgrade.
    expect(screen.getAllByText(/declassato a/)).toHaveLength(1);
    expect(screen.getByText("declassato a balanced")).toBeTruthy();
  });

  it("renders assistant Markdown by default without renderMarkdown", () => {
    render(<MessageList messages={[assistantMessage("a1", undefined, "**Forte** e [sito](https://example.com)")]} />);
    expect(screen.getByText("Forte").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "sito" }).getAttribute("target")).toBe("_blank");
  });

  it("names tool parts from their type and shows their state", () => {
    const message = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-read_chapter",
          toolCallId: "c1",
          state: "output-available",
          input: { chapter: 2 },
          output: "testo",
        },
        { type: "tool-search_book", toolCallId: "c2", state: "input-streaming", input: undefined },
        { type: "tool-search_book", toolCallId: "c3", state: "output-error", input: {}, errorText: "boom" },
      ],
    } as unknown as ChatUIMessage;
    render(<MessageList messages={[message]} />);

    expect(screen.getByText("Legge il capitolo 2")).toBeTruthy();
    expect(screen.getByText("· fatto")).toBeTruthy();
    expect(screen.getByText("· in corso")).toBeTruthy();
    expect(screen.getByText("· errore")).toBeTruthy();
    expect(screen.getAllByText("Cerca nel libro")).toHaveLength(2);
  });
});

describe("describeChatError", () => {
  it("returns the server's error text from a JSON body", () => {
    expect(describeChatError(new Error('{"error":"Trascrizione non trovata"}'))).toBe(
      "Trascrizione non trovata",
    );
  });

  it("returns plain messages unchanged", () => {
    expect(describeChatError(new Error("Network down"))).toBe("Network down");
  });

  it("returns the Italian text of a stream error unchanged", () => {
    const text = "Il modello non è disponibile in questo momento (limiti dei piani gratuiti). Riprova tra 78 secondi.";
    expect(describeChatError(new Error(text))).toBe(text);
  });
});

describe("ChatPanel", () => {
  it("renders the heading, the source and the empty state when open", () => {
    render(
      <ChatPanel
        source={{ kind: "episode", id: "alpha" }}
        title="Episodio alfa"
        subtitle="Show beta"
        suggestions={["Domanda uno"]}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Chatta con l'AI")).toBeTruthy();
    expect(screen.getByText("Episodio alfa · Show beta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Domanda uno" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Invia/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the notice above the messages", () => {
    render(
      <ChatPanel
        source={{ kind: "book", id: "eec5cpre" }}
        title="Libro"
        notice="Senza sintesi la chat è più lenta."
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText("Senza sintesi la chat è più lenta.")).toBeTruthy();
  });
});
