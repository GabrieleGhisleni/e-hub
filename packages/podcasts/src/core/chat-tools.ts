/** Tools of the episode chat. Node only (uses the chat's tool helper); the schema itself is in `chat-edit.ts`. */
import { defineTool, type ToolSet } from "@ehub/chat/node";
import {
  EPISODE_EDIT_PROPOSAL_MESSAGE,
  PROPOSE_EPISODE_EDIT_TOOL,
  ProposeEpisodeEditInput,
} from "./chat-edit";

/** Rough size of the tool definition, added to the prompt budget. */
export const EPISODE_TOOLS_TOKENS = 250;

/**
 * `propose_episode_edit`: checks the proposed summary / notes / tags / guests and answers. It never saves: the web UI
 * shows the proposal and the user decides whether to apply it.
 */
export function episodeChatTools(): ToolSet {
  return {
    [PROPOSE_EPISODE_EDIT_TOOL]: defineTool({
      description:
        "Propone una modifica alla scheda dell'episodio: i punti chiave (summary), gli Appunti (notes, Markdown), i tag o gli ospiti. Ogni campo indicato SOSTITUISCE per intero quello attuale, quindi riporta anche le parti da mantenere. Non salva nulla: l'utente rivede la proposta e decide se applicarla. Non serve per aggiungere una nota in fondo (usa save_note).",
      inputSchema: ProposeEpisodeEditInput,
      execute: (input) => {
        const parsed = ProposeEpisodeEditInput.safeParse(input);
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "formato non valido";
          return `La proposta non è valida: ${message}. Correggi e chiama di nuovo ${PROPOSE_EPISODE_EDIT_TOOL}.`;
        }
        return EPISODE_EDIT_PROPOSAL_MESSAGE;
      },
    }),
  };
}
