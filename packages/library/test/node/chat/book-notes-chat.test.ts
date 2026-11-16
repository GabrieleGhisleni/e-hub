// What the book chat sees of the page (Appunti, highlights, thread notes) and the tool that proposes the Appunti.

import { describe, expect, it } from "vitest";
import { renderBookPrompt } from "../../../src/node/chat/prompt.ts";
import { bookTools } from "../../../src/node/chat/tools.ts";
import { PROPOSE_BOOK_NOTES_TOOL } from "../../../src/shared/chat-edit.ts";
import type { Book } from "../../../src/shared/schema.ts";

const book = { id: "fx000001", title: "Libro", authors: ["A. Autore"] } as unknown as Book;

describe("renderBookPrompt: the user's page", () => {
  it("includes the Appunti, the highlights with their notes and the thread notes", () => {
    const system = renderBookPrompt({
      book,
      summary: null,
      notes: "# Idee\nUn appunto.",
      highlights: [
        { text: "Prima frase.", chapter: "Uno", page: 3, note: "bella" },
        { text: "Seconda frase.", chapter: "Uno" },
      ],
      threadNotes: [{ body: "Nota del thread.", pinned: true, createdAt: "2026-11-10T10:00:00Z" }],
    });
    expect(system).toContain("Un appunto.");
    expect(system).toContain("### Uno");
    expect(system).toContain("«Prima frase.» (p. 3)");
    expect(system).toContain("Nota dell'utente: bella");
    expect(system).toContain("Nota del thread.");
    expect(system).toContain(PROPOSE_BOOK_NOTES_TOOL);
  });

  it("says the Appunti are empty and skips the empty sections", () => {
    const system = renderBookPrompt({ book, summary: null });
    expect(system).toContain("(vuoto)");
    expect(system).not.toContain("Sottolineature dell'utente");
    expect(system).not.toContain("Note dell'utente (thread");
  });
});

describe("propose_book_notes", () => {
  const tools = bookTools({ summary: null, loadText: async () => { throw new Error("no text"); } });
  const tool = tools[PROPOSE_BOOK_NOTES_TOOL] as unknown as {
    execute: (input: unknown, options?: unknown) => string;
  };

  it("answers that nothing is saved yet", () => {
    expect(tool.execute({ notes: "Testo." })).toContain("Non è ancora stata salvata");
  });

  it("rejects an empty proposal", () => {
    expect(tool.execute({ notes: "  " })).toContain("non è valida");
  });
});
