import { describe, expect, it, vi } from "vitest";
import { chatNoteBody, handleSaveNoteToolCall, resolveNoteLabels } from "../../src/web/notes.ts";

const call = (toolName: string, input: unknown) => ({ toolName, toolCallId: "call-1", input });

describe("handleSaveNoteToolCall", () => {
  it("stores the note through onSaveNote and reports Nota salvata to the model", async () => {
    const onSaveNote = vi.fn();
    const addToolOutput = vi.fn();

    const handled = await handleSaveNoteToolCall({
      toolCall: call("save_note", { text: "  Il capitolo 2 sostiene che le abitudini si costruiscono.  " }),
      onSaveNote,
      model: "smart-07",
      addToolOutput,
    });

    expect(handled).toBe(true);
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onSaveNote).toHaveBeenCalledWith({
      answer: "Il capitolo 2 sostiene che le abitudini si costruiscono.",
      model: "smart-07",
    });
    expect(addToolOutput).toHaveBeenCalledWith({ tool: "save_note", toolCallId: "call-1", output: "Nota salvata." });
  });

  it("says that notes cannot be saved here when there is no onSaveNote", async () => {
    const addToolOutput = vi.fn();
    const handled = await handleSaveNoteToolCall({
      toolCall: call("save_note", { text: "Una nota" }),
      addToolOutput,
    });

    expect(handled).toBe(true);
    expect(addToolOutput).toHaveBeenCalledWith({
      tool: "save_note",
      toolCallId: "call-1",
      output: "Qui non è possibile salvare note.",
    });
  });

  it("reports an invalid input without calling onSaveNote", async () => {
    const onSaveNote = vi.fn();
    const addToolOutput = vi.fn();

    await handleSaveNoteToolCall({ toolCall: call("save_note", { text: "   " }), onSaveNote, addToolOutput });
    await handleSaveNoteToolCall({ toolCall: call("save_note", {}), onSaveNote, addToolOutput });

    expect(onSaveNote).not.toHaveBeenCalled();
    expect(addToolOutput).toHaveBeenCalledTimes(2);
    for (const [result] of addToolOutput.mock.calls) {
      expect(result.output).toMatch(/^Nota non salvata: /);
    }
  });

  it("reports the message of an error thrown by onSaveNote", async () => {
    const addToolOutput = vi.fn();
    const onSaveNote = vi.fn(() => {
      throw new Error("Archivio non raggiungibile");
    });

    const handled = await handleSaveNoteToolCall({
      toolCall: call("save_note", { text: "Una nota" }),
      onSaveNote,
      addToolOutput,
    });

    expect(handled).toBe(true);
    expect(addToolOutput).toHaveBeenCalledWith({
      tool: "save_note",
      toolCallId: "call-1",
      output: "Nota non salvata: Archivio non raggiungibile",
    });
  });

  it("waits for an async onSaveNote before reporting success", async () => {
    const order: string[] = [];
    const onSaveNote = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("saved");
    });
    const addToolOutput = vi.fn(() => order.push("reported"));

    await handleSaveNoteToolCall({ toolCall: call("save_note", { text: "Una nota" }), onSaveNote, addToolOutput });

    expect(order).toEqual(["saved", "reported"]);
  });

  it("ignores the calls of other tools", async () => {
    const onSaveNote = vi.fn();
    const addToolOutput = vi.fn();

    const handled = await handleSaveNoteToolCall({
      toolCall: call("read_chapter", { chapter: 1 }),
      onSaveNote,
      addToolOutput,
    });

    expect(handled).toBe(false);
    expect(onSaveNote).not.toHaveBeenCalled();
    expect(addToolOutput).not.toHaveBeenCalled();
  });
});

describe("chatNoteBody without a question", () => {
  it("is the answer and the origin line only", () => {
    expect(chatNoteBody({ answer: "Risposta.", model: "smart-model" })).toBe(
      "Risposta.\n\n*— Dalla chat con l'AI (smart-model)*",
    );
  });

  it("skips an empty question", () => {
    expect(chatNoteBody({ question: "   ", answer: "Risposta." })).toBe("Risposta.\n\n*— Dalla chat con l'AI*");
  });
});

describe("resolveNoteLabels", () => {
  it("fills in the chat's own labels by default", () => {
    expect(resolveNoteLabels()).toEqual({
      save: "Salva come nota",
      saved: "Salvata",
      savedOutput: "Nota salvata.",
      savedTitle: "Nota salvata",
      placeholder: "Fai una domanda, o chiedi di salvare una nota",
    });
  });

  it("keeps the labels the caller gives and defaults the others", () => {
    expect(resolveNoteLabels({ save: "Aggiungi", savedOutput: "Fatto." })).toEqual({
      save: "Aggiungi",
      saved: "Salvata",
      savedOutput: "Fatto.",
      savedTitle: "Nota salvata",
      placeholder: "Fai una domanda, o chiedi di salvare una nota",
    });
  });

  it("takes the card title and the placeholder from the caller", () => {
    expect(
      resolveNoteLabels({
        savedTitle: "Aggiunto al quaderno",
        placeholder: "Fai una domanda, o chiedi di aggiungere al quaderno",
      }),
    ).toMatchObject({
      savedTitle: "Aggiunto al quaderno",
      placeholder: "Fai una domanda, o chiedi di aggiungere al quaderno",
    });
  });
});
