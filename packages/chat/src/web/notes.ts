/**
 * What the chat hands to its caller when the user saves an answer as a note.
 * The chat does not know about notes: the caller decides where the note goes.
 */
import { SAVE_NOTE_TOOL, SaveNoteToolInput } from "../shared/save-note";

export type SaveNoteInput = {
  /** The question the answer replies to. Absent for notes the model writes with the `save_note` tool. */
  question?: string;
  /** The answer, in Markdown. */
  answer: string;
  /** Model that answered, when the server reported it. */
  model?: string;
};

export type SaveNote = (note: SaveNoteInput) => void | Promise<void>;

/**
 * Body of the note (Markdown): the question in bold (when there is one), the answer, then a line in italics saying
 * where it comes from.
 */
export function chatNoteBody({ question, answer, model }: SaveNoteInput): string {
  const origin = model ? `*— Dalla chat con l'AI (${model})*` : "*— Dalla chat con l'AI*";
  const asked = question?.trim().replace(/\s+/g, " ") ?? "";
  const parts = [asked === "" ? "" : `**${asked}**`, answer.trim(), origin];
  return parts.filter((part) => part !== "").join("\n\n");
}

/** A client-side tool call, as `useChat`'s `onToolCall` receives it. */
export type SaveNoteToolCall = { toolName: string; toolCallId: string; input: unknown };

/** The result sent back for a tool call: `addToolOutput` of `useChat` (`addToolResult` is the deprecated alias). */
export type SaveNoteToolOutput = { tool: string; toolCallId: string; output: string };

/** What the browser answers the model after a `save_note` call that went through. */
export const NOTE_SAVED_OUTPUT = "Nota salvata.";
/** The same, in notes mode: the text went into the draft, not into the notes. */
export const NOTE_DRAFTED_OUTPUT = "Aggiunta alla bozza degli appunti.";

export type SaveNoteToolHandlerArgs = {
  toolCall: SaveNoteToolCall;
  onSaveNote?: SaveNote;
  /** Model of the reply that asked for the note, when known. */
  model?: string;
  addToolOutput: (result: SaveNoteToolOutput) => unknown;
  /** Answer sent back on success. Default `NOTE_SAVED_OUTPUT`; notes mode passes `NOTE_DRAFTED_OUTPUT`. */
  successOutput?: string;
};

/**
 * Handles a `save_note` tool call: stores the note through `onSaveNote` and reports the outcome to the model.
 * Returns false (and does nothing) for any other tool, so it can be called for every tool call.
 */
export async function handleSaveNoteToolCall({
  toolCall,
  onSaveNote,
  model,
  addToolOutput,
  successOutput = NOTE_SAVED_OUTPUT,
}: SaveNoteToolHandlerArgs): Promise<boolean> {
  if (toolCall.toolName !== SAVE_NOTE_TOOL) return false;

  const reply = (output: string) =>
    addToolOutput({ tool: SAVE_NOTE_TOOL, toolCallId: toolCall.toolCallId, output });

  if (!onSaveNote) {
    await reply("Qui non è possibile salvare note.");
    return true;
  }

  const parsed = SaveNoteToolInput.safeParse(toolCall.input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "input non valido";
    await reply(`Nota non salvata: ${message}`);
    return true;
  }

  try {
    await onSaveNote({ answer: parsed.data.text, model });
  } catch (error) {
    await reply(`Nota non salvata: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
  await reply(successOutput);
  return true;
}
