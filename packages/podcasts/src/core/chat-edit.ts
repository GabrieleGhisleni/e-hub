/**
 * The edit the episode chat proposes with `propose_episode_edit` (Italian messages). Isomorphic: the web UI parses the
 * tool input with the same schema and shows it for confirmation. Nothing here writes: the user decides whether to apply it
 * (the dev UI then saves through the usual `PUT /api/podcasts/episodes/:slug`, transcript guard included).
 */
import { z } from "zod";
import { Guests, Notes, Summary, Tags } from "./schema";

export const PROPOSE_EPISODE_EDIT_TOOL = "propose_episode_edit";

/** Every field is optional; a present field REPLACES the current one (absent = unchanged). */
export const ProposeEpisodeEditInput = z
  .strictObject({
    summary: Summary.optional().describe(
      "Il NUOVO elenco completo dei punti chiave (sostituisce quello attuale; massimo 10 punti, 500 caratteri ciascuno)",
    ),
    notes: Notes.optional().describe(
      "Il NUOVO testo completo degli Appunti dell'episodio, in Markdown (sostituisce quello attuale)",
    ),
    tags: Tags.optional().describe("Il NUOVO elenco completo dei tag (inglese, minuscolo, kebab-case)"),
    guests: Guests.optional().describe("Il NUOVO elenco completo degli ospiti"),
  })
  .refine((edit) => Object.values(edit).some((value) => value !== undefined), {
    message: "la proposta non cambia nulla: indica almeno un campo",
  });
export type ProposeEpisodeEditInput = z.output<typeof ProposeEpisodeEditInput>;

/** What the tool answers when the proposal is valid: the model must not claim that anything was saved. */
export const EPISODE_EDIT_PROPOSAL_MESSAGE =
  "Proposta mostrata all'utente: la rivede e decide se applicarla. Non è ancora stata salvata.";
