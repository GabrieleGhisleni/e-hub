/**
 * The edit the book chat proposes with `propose_book_notes` (Italian messages). Isomorphic: the web UI parses the tool
 * input with the same schema and shows it for confirmation. Nothing here writes: the user decides whether to apply it
 * (the dev UI then saves through `PUT /api/library/books/:id/notes`).
 */
import { z } from "zod";
import { NOTES_MAX_CHARS } from "./api.ts";

export const PROPOSE_BOOK_NOTES_TOOL = "propose_book_notes";

export const ProposeBookNotesInput = z.strictObject({
  notes: z
    .string()
    .trim()
    .min(1)
    .max(NOTES_MAX_CHARS)
    .describe("Il NUOVO testo completo degli Appunti del libro, in Markdown (sostituisce quello attuale)"),
});
export type ProposeBookNotesInput = z.output<typeof ProposeBookNotesInput>;

/** What the tool answers when the proposal is valid: the model must not claim that anything was saved. */
export const BOOK_NOTES_PROPOSAL_MESSAGE =
  "Proposta mostrata all'utente: la rivede e decide se applicarla. Non è ancora stata salvata.";
