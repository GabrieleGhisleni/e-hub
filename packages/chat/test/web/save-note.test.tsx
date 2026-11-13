// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../src/web/chat-panel.tsx";
import { MessageList, noteFor } from "../../src/web/message-list.tsx";
import { chatNoteBody } from "../../src/web/notes.ts";
import type { ChatUIMessage } from "../../src/shared/types.ts";

afterEach(cleanup);

const user = (id: string, text: string): ChatUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistant = (
  id: string,
  parts: ChatUIMessage["parts"],
  metadata?: ChatUIMessage["metadata"],
): ChatUIMessage => ({ id, role: "assistant", parts, metadata });

const conversation = (): ChatUIMessage[] => [
  user("u1", "Qual è la tesi?"),
  assistant(
    "a1",
    [
      { type: "text", text: "**La tesi** è esposta al [12:34]." },
      {
        type: "tool-read_chapter",
        toolCallId: "c1",
        state: "output-available",
        input: { chapter: 2 },
        output: "testo",
      },
      { type: "text", text: "- punto uno\n- punto due (cap. 2)" },
    ] as unknown as ChatUIMessage["parts"],
    { model: "gemini-3.6-flash", provider: "google", tier: "smart" },
  ),
  user("u2", "E poi?"),
  assistant("a2", [{ type: "text", text: "Seconda risposta" }]),
];

describe("Salva come nota", () => {
  it("is not shown without onSaveNote", () => {
    render(<MessageList messages={conversation()} />);
    expect(screen.queryByRole("button", { name: /Salva come nota/ })).toBeNull();
  });

  it("is shown on each finished assistant reply only, not on questions", () => {
    render(<MessageList messages={conversation()} onSaveNote={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /Salva come nota/ })).toHaveLength(2);
  });

  it("is not shown on the reply still streaming", () => {
    render(<MessageList messages={conversation()} streaming onSaveNote={vi.fn()} />);
    // The earlier reply is finished, the last one (still streaming) is not.
    expect(screen.getAllByRole("button", { name: /Salva come nota/ })).toHaveLength(1);
  });

  it("calls onSaveNote with the question, the Markdown answer and the model, then shows Salvata", () => {
    const onSaveNote = vi.fn();
    render(<MessageList messages={conversation()} onSaveNote={onSaveNote} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Salva come nota" })[0] as HTMLElement);

    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onSaveNote).toHaveBeenCalledWith({
      question: "Qual è la tesi?",
      // The note keeps the Markdown: the notes render it.
      answer: "**La tesi** è esposta al [12:34].\n\n- punto uno\n- punto due (cap. 2)",
      model: "gemini-3.6-flash",
    });
    const saved = screen.getByRole("button", { name: "Salvata" });
    expect(saved.hasAttribute("disabled")).toBe(true);
    // The other reply is still offered.
    expect(screen.getByRole("button", { name: "Salva come nota" })).toBeTruthy();
  });

  it("omits the model when the reply does not report one", () => {
    const onSaveNote = vi.fn();
    render(<MessageList messages={conversation()} onSaveNote={onSaveNote} />);

    const buttons = screen.getAllByRole("button", { name: "Salva come nota" });
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onSaveNote.mock.calls[0]?.[0]).toEqual({ question: "E poi?", answer: "Seconda risposta" });
    expect(onSaveNote.mock.calls[0]?.[0]).not.toHaveProperty("model");
  });

  it("switches to Salvata once an async save finishes", async () => {
    const onSaveNote = vi.fn(() => Promise.resolve());
    render(<MessageList messages={conversation()} onSaveNote={onSaveNote} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Salva come nota" })[0] as HTMLElement);
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvata" })).toBeTruthy());
  });

  it("keeps the button when the save fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSaveNote = vi.fn(() => Promise.reject(new Error("rifiutata")));
    render(<MessageList messages={conversation()} onSaveNote={onSaveNote} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Salva come nota" })[0] as HTMLElement);
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getAllByRole("button", { name: "Salva come nota" })).toHaveLength(2);
    consoleError.mockRestore();
  });

  it("is not offered for a reply without a question or without text", () => {
    expect(noteFor([assistant("a0", [{ type: "text", text: "Senza domanda" }])], 0)).toBeUndefined();
    expect(noteFor([user("u", "Domanda"), assistant("a", [{ type: "text", text: "  " }])], 1)).toBeUndefined();
  });
});

describe("chatNoteBody", () => {
  it("puts the question in bold, the answer, and the origin in italics, in separate paragraphs", () => {
    expect(chatNoteBody({ question: " Domanda? ", answer: "Risposta.", model: "smart-model" })).toBe(
      "**Domanda?**\n\nRisposta.\n\n*— Dalla chat con l'AI (smart-model)*",
    );
  });

  it("omits the model in parentheses when unknown", () => {
    expect(chatNoteBody({ question: "Domanda?", answer: "Risposta." })).toBe(
      "**Domanda?**\n\nRisposta.\n\n*— Dalla chat con l'AI*",
    );
  });

  it("keeps a multi-line question on one bold line", () => {
    expect(chatNoteBody({ question: "Prima riga\nseconda", answer: "R." })).toBe(
      "**Prima riga seconda**\n\nR.\n\n*— Dalla chat con l'AI*",
    );
  });
});

describe("expanded panel text size", () => {
  it("renders replies and questions larger with textSize large", () => {
    const { container, rerender } = render(<MessageList messages={conversation()} />);
    const reply = () => container.querySelector(".group\\/reply div.leading-relaxed, .group\\/reply div[class*='text-[1.0625rem]']");
    expect(reply()?.className).toContain("text-sm");
    rerender(<MessageList messages={conversation()} textSize="large" />);
    expect(reply()?.className).toContain("text-[1.0625rem]");
    expect(screen.getByText("Qual è la tesi?").className).toContain("text-[1.0625rem]");
  });
});

describe("noteLabels", () => {
  it("renames the save button and the saved one, and keeps the defaults otherwise", async () => {
    const onSaveNote = vi.fn(() => Promise.resolve());
    render(
      <MessageList
        messages={conversation()}
        onSaveNote={onSaveNote}
        noteLabels={{ save: "Aggiungi al quaderno", saved: "Nel quaderno" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Salva come nota" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Aggiungi al quaderno" })[0] as HTMLElement);
    await waitFor(() => expect(screen.getByRole("button", { name: "Nel quaderno" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Aggiungi al quaderno" })).toBeTruthy();
  });

  it("reads a save_note result of the custom savedOutput as saved, not as a failure", () => {
    const messages: ChatUIMessage[] = [
      user("u1", "Aggiungilo al quaderno"),
      assistant("a1", [
        {
          type: "tool-save_note",
          toolCallId: "c1",
          state: "output-available",
          input: { text: "**Tesi** (cap. 2)" },
          output: "Aggiunto in fondo al quaderno.",
        } as unknown as ChatUIMessage["parts"][number],
      ]),
    ];
    render(<MessageList messages={messages} noteLabels={{ savedOutput: "Aggiunto in fondo al quaderno." }} />);
    expect(screen.getByText("Nota salvata")).toBeTruthy();
    expect(screen.queryByText("Aggiunto in fondo al quaderno.")).toBeNull();
  });

  it("titles the card of a saved note with savedTitle", () => {
    const messages: ChatUIMessage[] = [
      user("u1", "Aggiungilo al quaderno"),
      assistant("a1", [
        {
          type: "tool-save_note",
          toolCallId: "c1",
          state: "output-available",
          input: { text: "**Tesi** (cap. 2)" },
          output: "Aggiunto in fondo al quaderno.",
        } as unknown as ChatUIMessage["parts"][number],
      ]),
    ];
    render(
      <MessageList
        messages={messages}
        noteLabels={{ savedOutput: "Aggiunto in fondo al quaderno.", savedTitle: "Aggiunto al quaderno" }}
      />,
    );
    expect(screen.getByText("Aggiunto al quaderno")).toBeTruthy();
    expect(screen.queryByText("Nota salvata")).toBeNull();
  });

  it("keeps the failure title of the card when savedTitle is set", () => {
    const messages: ChatUIMessage[] = [
      user("u1", "Aggiungilo al quaderno"),
      assistant("a1", [
        {
          type: "tool-save_note",
          toolCallId: "c1",
          state: "output-available",
          input: { text: "**Tesi**" },
          output: "Nota non salvata: rifiutata",
        } as unknown as ChatUIMessage["parts"][number],
      ]),
    ];
    render(<MessageList messages={messages} noteLabels={{ savedTitle: "Aggiunto al quaderno" }} />);
    expect(screen.getByText("Nota non salvata: rifiutata")).toBeTruthy();
    expect(screen.queryByText("Aggiunto al quaderno")).toBeNull();
  });

  it("shows the placeholder of the question box from noteLabels when notes can be saved", () => {
    const placeholder = "Fai una domanda, o chiedi di aggiungere al quaderno";
    const source = { kind: "episode", id: "alpha" } as const;
    const { unmount } = render(
      <ChatPanel
        source={source}
        title="Episodio alfa"
        open
        onOpenChange={() => {}}
        onSaveNote={vi.fn()}
        noteLabels={{ placeholder }}
      />,
    );
    expect((screen.getByLabelText("Messaggio") as HTMLTextAreaElement).placeholder).toBe(placeholder);
    unmount();

    render(<ChatPanel source={source} title="Episodio alfa" open onOpenChange={() => {}} />);
    expect((screen.getByLabelText("Messaggio") as HTMLTextAreaElement).placeholder).toBe("Fai una domanda");
  });

  it("keeps the default placeholder when the caller does not set one", () => {
    const source = { kind: "episode", id: "alpha" } as const;
    render(<ChatPanel source={source} title="Episodio alfa" open onOpenChange={() => {}} onSaveNote={vi.fn()} />);
    expect((screen.getByLabelText("Messaggio") as HTMLTextAreaElement).placeholder).toBe(
      "Fai una domanda, o chiedi di salvare una nota",
    );
  });
});
