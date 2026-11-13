/**
 * The notebook the chat proposes with `propose_notebook` (Italian messages). Isomorphic: the web UI parses the tool
 * input with the same schema and shows it for confirmation. Nothing here writes: the user decides whether to replace
 * the notebook.
 */
import { z } from "zod";
import { MAX_NOTEBOOK_LENGTH } from "../schema.ts";

export const PROPOSE_NOTEBOOK_TOOL = "propose_notebook";

/** The whole new text of the notebook, as the model proposes it. */
export const ProposeNotebookInput = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1, "Il quaderno proposto è vuoto")
    .max(MAX_NOTEBOOK_LENGTH, `Il quaderno supera ${MAX_NOTEBOOK_LENGTH} caratteri`)
    .describe("Il testo COMPLETO del nuovo Quaderno, in Markdown: sostituisce quello attuale"),
});
export type ProposeNotebookInput = z.output<typeof ProposeNotebookInput>;

/** What the tool answers when the proposal is valid: the model must not claim that the notebook was replaced. */
export const NOTEBOOK_PROPOSAL_MESSAGE =
  "Proposta mostrata all'utente: la rivede e decide se sostituire il quaderno. Non è ancora stata salvata.";
