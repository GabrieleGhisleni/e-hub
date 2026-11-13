// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftPanel } from "../../src/web/draft-panel.tsx";
import { MessageList } from "../../src/web/message-list.tsx";
import { NOTE_DRAFTED_OUTPUT, handleSaveNoteToolCall } from "../../src/web/notes.ts";
import {
  type DraftEntry,
  draftNoteText,
  loadDraft,
  loadNotesMode,
  moveEntry,
  saveDraft,
  saveNotesMode,
} from "../../src/web/notes-draft.ts";
import type { ChatSource, ChatUIMessage } from "../../src/shared/types.ts";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const book: ChatSource = { kind: "book", id: "eec5cpre" };
const entry = (id: string, text: string, messageId?: string): DraftEntry => ({ id, text, ...(messageId ? { messageId } : {}) });

describe("notes-draft storage", () => {
  it("keeps the draft and the mode per source", () => {
    saveDraft(book, [entry("1", "**A**\n\ntesto")]);
    saveNotesMode(book, true);
    expect(loadDraft(book)).toEqual([entry("1", "**A**\n\ntesto")]);
    expect(loadNotesMode(book)).toBe(true);
    expect(loadDraft({ kind: "book", id: "other123" })).toEqual([]);
    expect(loadNotesMode({ kind: "book", id: "other123" })).toBe(false);
    saveDraft(book, []);
    expect(window.localStorage.getItem("ehub:chat-draft:book:eec5cpre")).toBeNull();
  });

  it("ignores a corrupted draft", () => {
    window.localStorage.setItem("ehub:chat-draft:book:eec5cpre", "{nope");
    expect(loadDraft(book)).toEqual([]);
  });

  it("joins the entries with a blank line and moves them", () => {
    const entries = [entry("1", " uno "), entry("2", "due"), entry("3", "")];
    expect(draftNoteText(entries)).toBe("uno\n\ndue");
    expect(moveEntry(entries, 1, -1).map((e) => e.id)).toEqual(["2", "1", "3"]);
    expect(moveEntry(entries, 0, -1).map((e) => e.id)).toEqual(["1", "2", "3"]);
  });
});

describe("Aggiungi alla bozza", () => {
  const messages: ChatUIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Perché?" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "**Il tempo**\n\nNon è breve (cap. 4)." }] },
  ];

  it("replaces Salva come nota in notes mode and hands over the reply's Markdown", () => {
    const onAddToDraft = vi.fn();
    render(<MessageList messages={messages} onSaveNote={vi.fn()} onAddToDraft={onAddToDraft} />);
    expect(screen.queryByRole("button", { name: /Salva come nota/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Aggiungi alla bozza/ }));
    expect(onAddToDraft).toHaveBeenCalledWith({ messageId: "a1", text: "**Il tempo**\n\nNon è breve (cap. 4)." });
  });

  it("shows Nella bozza for a reply already in the draft", () => {
    render(<MessageList messages={messages} onAddToDraft={vi.fn()} draftedIds={new Set(["a1"])} />);
    expect(screen.getByRole("button", { name: /Nella bozza/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("save_note in notes mode", () => {
  it("answers the model that the text went into the draft", async () => {
    const onSaveNote = vi.fn();
    const addToolOutput = vi.fn();
    await handleSaveNoteToolCall({
      toolCall: { toolName: "save_note", toolCallId: "c1", input: { text: "**Nota**" } },
      onSaveNote,
      addToolOutput,
      successOutput: NOTE_DRAFTED_OUTPUT,
    });
    expect(onSaveNote).toHaveBeenCalledWith({ answer: "**Nota**" });
    expect(addToolOutput).toHaveBeenCalledWith({ tool: "save_note", toolCallId: "c1", output: NOTE_DRAFTED_OUTPUT });
  });
});

describe("DraftPanel", () => {
  it("saves the whole draft as one note and empties it", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onChange = vi.fn();
    render(<DraftPanel entries={[entry("1", "**A**"), entry("2", "**B**")]} onChange={onChange} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Salva come nota/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(onSave).toHaveBeenCalledWith("**A**\n\n**B**");
  });

  it("edits, moves and removes entries", () => {
    const onChange = vi.fn();
    const entries = [entry("1", "uno"), entry("2", "due")];
    render(<DraftPanel entries={entries} onChange={onChange} onSave={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Sposta giù" })[0]!);
    expect(onChange).toHaveBeenLastCalledWith([entries[1], entries[0]]);

    fireEvent.click(screen.getAllByRole("button", { name: "Togli dalla bozza" })[1]!);
    expect(onChange).toHaveBeenLastCalledWith([entries[0]]);

    fireEvent.click(screen.getAllByRole("button", { name: "Modifica" })[0]!);
    fireEvent.change(screen.getByLabelText("Modifica il paragrafo"), { target: { value: "uno corretto" } });
    fireEvent.click(screen.getByRole("button", { name: "Fatto" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...entries[0], text: "uno corretto" }, entries[1]]);
  });

  it("asks before emptying the draft", () => {
    const onChange = vi.fn();
    render(<DraftPanel entries={[entry("1", "uno")]} onChange={onChange} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Svuota/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Svuota" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
