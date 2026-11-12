/**
 * What the chat hands to its caller when the user saves an answer as a note.
 * The chat does not know about notes: the caller decides where the note goes.
 */
export type SaveNoteInput = {
  question: string;
  /** Plain text of the answer (see `markdownToPlainText`). */
  answer: string;
  /** Model that answered, when the server reported it. */
  model?: string;
};

export type SaveNote = (note: SaveNoteInput) => void | Promise<void>;

/** Body of the note: question, answer, then a line saying where it comes from. */
export function chatNoteBody({ question, answer, model }: SaveNoteInput): string {
  const origin = model ? `— Dalla chat con l'AI (${model})` : "— Dalla chat con l'AI";
  return [question.trim(), answer.trim(), origin].join("\n\n");
}
