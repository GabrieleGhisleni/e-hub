/**
 * Notes write server for the Vite dev server (mounted by vite.config.ts; never in the production build).
 * Notes on episodes go through the podcasts transcript guard: the repo is public, so a note cannot carry a long
 * verbatim excerpt of a third-party transcript (same rule as episode summaries and notes).
 */
import { createNotesApp } from "@ehub/notes/server";
import { findEpisodeNoteExcerpts } from "@ehub/podcasts/note-guard";

export default createNotesApp({
  guard: async (item, body) => {
    if (item.module !== "podcasts") return [];
    const excerpts = await findEpisodeNoteExcerpts(item.id, body);
    return excerpts.map((preview) => `«${preview}»`);
  },
});
