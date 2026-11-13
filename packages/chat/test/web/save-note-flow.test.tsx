// @vitest-environment jsdom
// End-to-end in the browser side: the model calls save_note, the panel stores the note through onSaveNote,
// answers the tool and sends the conversation back so the model can confirm.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../src/web/chat-panel.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function sse(chunks: unknown[]): Response {
  const body = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
  });
}

describe("save_note through the chat panel", () => {
  it("saves the note, answers the tool and lets the model confirm", async () => {
    const bodies: { messages: { role: string; parts: { type: string; state?: string; output?: unknown }[] }[] }[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return sse([
          { type: "start", messageId: "a1" },
          { type: "start-step" },
          { type: "tool-input-start", toolCallId: "call-1", toolName: "save_note" },
          {
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "save_note",
            input: { text: "La vita non è breve: la sprechiamo (cap. 1)." },
          },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      }
      // The server streams with `originalMessages`: the continuation keeps the assistant message's ID.
      return sse([
        { type: "start", messageId: "a1" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Fatto, l'ho aggiunta alle note." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaveNote = vi.fn();

    render(
      <ChatPanel
        source={{ kind: "book", id: "eec5cpre" }}
        title="La brevità della vita"
        onSaveNote={onSaveNote}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Messaggio" }), {
      target: { value: "Interessante, aggiungilo alle note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invia" }));

    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1));
    expect(onSaveNote).toHaveBeenCalledWith({ answer: "La vita non è breve: la sprechiamo (cap. 1).", model: undefined });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const toolPart = bodies[1]?.messages.at(-1)?.parts.find((p) => p.type === "tool-save_note");
    expect(toolPart?.state).toBe("output-available");
    expect(toolPart?.output).toBe("Nota salvata.");
    expect(await screen.findByText("Fatto, l'ho aggiunta alle note.")).toBeTruthy();
    expect(screen.getAllByText("Nota salvata")).toHaveLength(1);
  });

  it("in notes mode puts the model's note in the draft instead of the notes, and sends the toggles", async () => {
    localStorage.setItem("ehub:chat-notes-mode:book:eec5cpre", "1");
    const bodies: { notesMode?: boolean; rich?: boolean; messages: { parts: { type: string; output?: unknown }[] }[] }[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return sse([
          { type: "start", messageId: "a1" },
          { type: "start-step" },
          { type: "tool-input-start", toolCallId: "call-1", toolName: "save_note" },
          { type: "tool-input-available", toolCallId: "call-1", toolName: "save_note", input: { text: "**Tempo**" } },
          { type: "finish-step" },
          { type: "finish" },
        ]);
      }
      return sse([
        { type: "start", messageId: "a1" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Aggiunta alla bozza." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaveNote = vi.fn();

    render(
      <ChatPanel
        source={{ kind: "book", id: "eec5cpre" }}
        title="La brevità della vita"
        onSaveNote={onSaveNote}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Appunti/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Feel rich/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Messaggio" }), { target: { value: "segnatelo" } });
    fireEvent.click(screen.getByRole("button", { name: "Invia" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies[0]).toMatchObject({ notesMode: true, rich: true });
    const toolPart = bodies[1]?.messages.at(-1)?.parts.find((p) => p.type === "tool-save_note");
    expect(toolPart?.output).toBe("Aggiunta alla bozza degli appunti.");
    expect(onSaveNote).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("ehub:chat-draft:book:eec5cpre") ?? "[]")).toMatchObject([{ text: "**Tempo**" }]);
    expect(await screen.findByText("Aggiunta alla bozza.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bozza appunti · 1/ })).toBeTruthy();
  });
});
