/*
 * The text a chat answer adds to the notebook: the question in bold (when there is one), a blank line, the answer.
 * No origin line: the notebook is one document, so the text must read as part of it. Pure, so it is unit-tested.
 */

/** What the chat hands over when an answer is saved: the same shape as `SaveNoteInput` of `@ehub/chat/web`. */
export type NotebookNote = { question?: string; answer: string };

export function notebookChunk({ question, answer }: NotebookNote): string {
  const asked = question?.trim().replace(/\s+/g, " ") ?? "";
  const parts = [asked === "" ? "" : `**${asked}**`, answer.trim()];
  return parts.filter((part) => part !== "").join("\n\n");
}
