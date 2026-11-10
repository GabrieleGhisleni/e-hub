/**
 * Build guard (Vite plugin): validates every notes file before the site is built, so an invalid or hand-broken
 * file fails `pnpm build` instead of being published (or silently dropped by the client).
 */
import type { Plugin } from "vite";
import { listAllNotes, notesDataDir } from "./repo.ts";

export function notesData(): Plugin {
  return {
    name: "ehub-notes-data",
    apply: "build",
    async buildStart() {
      const notes = await listAllNotes();
      this.info(`notes: ${notes.length} note(s) from ${notesDataDir()}`);
    },
  };
}
