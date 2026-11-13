// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_MIN_WIDTH,
  ChatPanel,
  clampChatWidth,
  describeChatError,
} from "../../src/web/chat-panel.tsx";
import {
  DEFAULT_SUGGESTIONS,
  MessageList,
  activityOf,
  formatToolOutput,
} from "../../src/web/message-list.tsx";
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

  it("replaces a tool chip with what renderToolPart returns, and keeps the chip otherwise", () => {
    const message = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-propose_verdicts",
          toolCallId: "c1",
          state: "output-available",
          input: { verdicts: [] },
          output: "Proposta mostrata all'utente",
        },
        { type: "tool-list_chapters", toolCallId: "c2", state: "output-available", input: {}, output: "1. Uno" },
      ],
    } as unknown as ChatUIMessage;
    const seen: unknown[] = [];
    render(
      <MessageList
        messages={[message]}
        renderToolPart={(part) => {
          seen.push(part);
          return part.toolName === "propose_verdicts" ? <p>Scheda dei verdetti</p> : undefined;
        }}
      />,
    );

    expect(screen.getByText("Scheda dei verdetti")).toBeTruthy();
    expect(screen.queryByText("Propone i verdetti")).toBeNull();
    // Not replaced: the chip is still there.
    expect(screen.getByText("Guarda l'indice")).toBeTruthy();
    expect(seen).toEqual([
      {
        toolName: "propose_verdicts",
        toolCallId: "c1",
        state: "output-available",
        input: { verdicts: [] },
        output: "Proposta mostrata all'utente",
      },
      { toolName: "list_chapters", toolCallId: "c2", state: "output-available", input: {}, output: "1. Uno" },
    ]);
  });

  it("shows the propose_verdicts chip without renderToolPart", () => {
    const message = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool-propose_verdicts", toolCallId: "c1", state: "output-available", input: {}, output: "ok" },
      ],
    } as unknown as ChatUIMessage;
    render(<MessageList messages={[message]} />);
    expect(screen.getByText("Propone i verdetti")).toBeTruthy();
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

  it("is not rendered when closed", () => {
    render(<ChatPanel source={{ kind: "book", id: "eec5cpre" }} title="Libro" open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with the X button and with Esc", () => {
    const onOpenChange = vi.fn();
    render(<ChatPanel source={{ kind: "book", id: "eec5cpre" }} title="Libro" open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Chiudi/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Messaggio" }), { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("expands to a large window and back", () => {
    render(<ChatPanel source={{ kind: "book", id: "eec5cpre" }} title="Libro" open onOpenChange={() => {}} />);
    expect(screen.getByRole("separator", { name: "Ridimensiona la chat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ingrandisci" }));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.queryByRole("separator", { name: "Ridimensiona la chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Riduci" }));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
  });

  it("names the source in the empty state", () => {
    render(<ChatPanel source={{ kind: "book", id: "eec5cpre" }} title="La brevità della vita" open onOpenChange={() => {}} />);
    expect(screen.getByText(/Chiedi qualcosa su/).textContent).toContain("La brevità della vita");
  });
});

describe("clampChatWidth", () => {
  it("keeps the width between the minimum and 80% of the window", () => {
    expect(clampChatWidth(100, 1600)).toBe(CHAT_MIN_WIDTH);
    expect(clampChatWidth(600, 1600)).toBe(600);
    expect(clampChatWidth(1500, 1600)).toBe(1280);
    expect(clampChatWidth(500, 300)).toBe(CHAT_MIN_WIDTH);
  });
});

describe("save_note in the message list", () => {
  it("shows the note the model saved instead of a chip", () => {
    const messages: ChatUIMessage[] = [
      userMessage("u1", "Aggiungilo alle note"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-save_note",
            toolCallId: "call-1",
            state: "output-available",
            input: { text: "Il tempo non è breve: lo sprechiamo (cap. 1)." },
            output: "Nota salvata.",
          },
          { type: "text", text: "Fatto, l'ho aggiunta alle note." },
        ],
      } as ChatUIMessage,
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText("Nota salvata")).toBeTruthy();
    expect(screen.getByText("Il tempo non è breve: lo sprechiamo (cap. 1).")).toBeTruthy();
    expect(screen.queryByText("Salva una nota")).toBeNull();
  });

  it("shows why a note was not saved", () => {
    const messages: ChatUIMessage[] = [
      userMessage("u1", "Salvalo"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-save_note",
            toolCallId: "call-1",
            state: "output-available",
            input: { text: "Testo" },
            output: "Qui non è possibile salvare note.",
          },
        ],
      } as ChatUIMessage,
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText("Qui non è possibile salvare note.")).toBeTruthy();
  });
});

describe("loader and tool output", () => {
  const assistant = (parts: ChatUIMessage["parts"]): ChatUIMessage => ({ id: "a1", role: "assistant", parts });

  it("names what the model is doing from its last part", () => {
    expect(activityOf(assistant([]))).toBe("Sta pensando…");
    expect(activityOf(assistant([{ type: "reasoning", text: "…" }]))).toBe("Sta ragionando…");
    expect(activityOf(assistant([{ type: "text", text: "Ecco" }]))).toBe("Sta scrivendo…");
    expect(
      activityOf(
        assistant([
          { type: "tool-read_chapter", toolCallId: "c1", state: "input-available", input: { chapter: 4 } },
        ] as ChatUIMessage["parts"]),
      ),
    ).toBe("Legge il capitolo 4…");
    expect(
      activityOf(
        assistant([
          {
            type: "tool-read_chapter",
            toolCallId: "c1",
            state: "output-available",
            input: { chapter: 4 },
            output: "testo",
          },
        ] as ChatUIMessage["parts"]),
      ),
    ).toBe("Sta pensando…");
  });

  it("shows the loader under the reply while it streams, and hides it when done", () => {
    const messages = [
      userMessage("u1", "Di cosa parla?"),
      assistant([
        { type: "tool-search_book", toolCallId: "c1", state: "input-available", input: { query: "tempo" } },
      ] as ChatUIMessage["parts"]),
    ];
    const { rerender } = render(<MessageList messages={messages} streaming />);
    expect(screen.getByRole("status").textContent).toContain("Cerca «tempo»…");
    rerender(<MessageList messages={messages} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens the output of a finished tool on click", () => {
    const messages = [
      userMessage("u1", "Indice?"),
      assistant([
        {
          type: "tool-list_chapters",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: "1. De brevitate vitae (3200 parole)",
        },
      ] as ChatUIMessage["parts"]),
    ];
    render(<MessageList messages={messages} />);
    const chip = screen.getByRole("button", { name: /Guarda l'indice/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("1. De brevitate vitae (3200 parole)")).toBeNull();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("1. De brevitate vitae (3200 parole)")).toBeTruthy();
  });

  it("formats non-string outputs as JSON", () => {
    expect(formatToolOutput({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(formatToolOutput(undefined)).toBe("");
  });
});
