/**
 * Notes store for the running app:
 * - dev: the local notes API (/api/notes, files in packages/notes/data, editable);
 * - build: the notes files bundled at build time, read-only (the build already validated them).
 */
import { HOSTED } from "./session";
import { type NotesStore, createHttpNotesStore, createStaticNotesStore } from "@ehub/notes";

interface NotesFileModule {
  item: unknown;
  notes: readonly Record<string, unknown>[];
}

export function createAppNotesStore(): NotesStore {
  if (HOSTED || import.meta.env.DEV) return createHttpNotesStore();
  const files = import.meta.glob<NotesFileModule>("../../../packages/notes/data/*/*.json", {
    eager: true,
    import: "default",
  });
  return createStaticNotesStore(
    Object.values(files).flatMap((file) =>
      file.notes.map((note) => ({ ...note, item: file.item })),
    ),
  );
}
