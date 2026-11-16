/**
 * Notes write server for the Vite dev server (mounted by vite.config.ts; never in the production build).
 * No transcript guard on notes: they are the user's own words, and the user decided not to limit quotes there.
 * (Episode summaries and notes saved from the podcasts "Modifica" dialog still go through the 20-word guard.)
 */
import { createNotesApp } from "@ehub/notes/server";

export default createNotesApp();
