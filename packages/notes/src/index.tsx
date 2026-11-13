import type { RouteObject } from "react-router";
import { NotesPage } from "./notes-page";

export { NoteMarkdown, markdownPreview } from "./markdown";
export { NoteCard, NoteEditor, noteAnchor } from "./note-card";
export {
  NOTES_PATH,
  NOTES_SECTION_ID,
  NoteCountBadge,
  NoteThread,
  NotesJumpLink,
  useNoteFlash,
} from "./note-thread";
export { NotesPage } from "./notes-page";
export {
  type NotesMeta,
  type NotesStore,
  createHttpNotesStore,
  createMemoryNotesStore,
  createStaticNotesStore,
  notesStore,
  setNotesStore,
  useItemNotes,
  useNoteCounts,
  useNotes,
  useNotesMeta,
} from "./store";
export { NotesErrorBanner } from "./status";
export { formatNoteDate, matchesTokens, notesCount, searchTokens } from "./text";
export { MODULE_LABELS, type Note, type NoteItemRef, type NoteModule, itemKey } from "./types";

/** The notes module's routes, spread into the shell's router (`/notes`). */
export function notesRoutes(): RouteObject[] {
  return [{ path: "notes", element: <NotesPage /> }];
}
