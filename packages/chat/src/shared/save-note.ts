/**
 * The `save_note` tool: a client-side tool (no `execute`). The model asks to save a note, the browser stores it
 * through the caller's `onSaveNote`, and the result goes back to the model as the tool output.
 */
import { tool } from "ai";
import { z } from "zod";

export const SAVE_NOTE_TOOL = "save_note";

export const SaveNoteToolInput = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      "Il testo della nota, in italiano e in Markdown. Deve essere autosufficiente e leggibile anche a distanza di tempo: riformula il punto rilevante senza rimandi come «come detto prima». Apri con una riga in grassetto che dice di cosa parla la nota; metti in **grassetto** i concetti chiave; usa un elenco puntato quando i punti sono più di due; indica sempre il capitolo, come (cap. N), o la pagina quando li conosci; le citazioni brevi vanno tra virgolette «».",
    ),
});

export type SaveNoteToolInput = z.infer<typeof SaveNoteToolInput>;

/** The tool the model sees: the server adds it to every chat, and it has no `execute`. */
export const saveNoteTool = tool({
  description:
    "Salva una nota sul libro, sull'esplorazione o sulla puntata di cui si sta parlando. Usalo solo quando l'utente chiede di salvare o aggiungere qualcosa alle note.",
  inputSchema: SaveNoteToolInput,
});
