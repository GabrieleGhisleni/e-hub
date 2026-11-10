/** Which module a note belongs to. */
export type NoteModule = "library" | "podcasts";

export const MODULE_LABELS: Readonly<Record<NoteModule, string>> = {
  library: "Libri",
  podcasts: "Podcast",
};

/**
 * What a note is about: a book or an episode. Title, subtitle and href are a snapshot taken when the note is
 * written, so the notes page can list notes without loading both catalogs.
 */
export interface NoteItemRef {
  module: NoteModule;
  /** Book ID or episode slug. */
  id: string;
  title: string;
  /** Authors, or show name. */
  subtitle?: string;
  /** In-app path of the detail page. */
  href: string;
}

export interface Note {
  id: string;
  item: NoteItemRef;
  /** Plain text; line breaks are kept, URLs become links. */
  body: string;
  pinned: boolean;
  /** ISO instants. */
  createdAt: string;
  updatedAt: string;
}

/** `library:<id>` / `podcasts:<slug>`: one key per item (URL param, grouping). */
export function itemKey(item: Pick<NoteItemRef, "module" | "id">): string {
  return `${item.module}:${item.id}`;
}
