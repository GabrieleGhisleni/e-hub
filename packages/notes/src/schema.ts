/**
 * Validation of notes on the way in (server writes) and of the files on disk (server reads, build). The browser
 * never imports this file: the client trusts the server and checks the static bundle with `isNote` (store.ts).
 */
import { z } from "zod";

export const MAX_NOTE_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 500;

/** Book IDs and episode slugs: they become file names, so nothing else is accepted. */
export const ItemId = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/, "ID non valido");
export const NoteModule = z.enum(["library", "podcasts"]);
export const NoteId = z.uuid();

/** In-app path of the item's page, under its own module (no external or `javascript:` URLs). */
const Href = z
  .string()
  .max(1000)
  .regex(/^\/(library|podcasts)\/[A-Za-z0-9._~%/-]*$/, "Percorso non valido");

export const NoteItemRef = z
  .strictObject({
    module: NoteModule,
    id: ItemId,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    subtitle: z.string().trim().max(MAX_TITLE_LENGTH).optional(),
    href: Href,
  })
  .refine((item) => item.href.startsWith(`/${item.module}/`), {
    message: "Il percorso non appartiene al modulo",
    path: ["href"],
  });

export const NoteBody = z.string().trim().min(1, "La nota è vuota").max(MAX_NOTE_LENGTH);

const Instant = z.iso.datetime();

export const Note = z.strictObject({
  id: NoteId,
  item: NoteItemRef,
  body: NoteBody,
  pinned: z.boolean(),
  createdAt: Instant,
  updatedAt: Instant,
});

/** One file per item: `data/<module>/<id>.json`. Notes are stored without the item (it is the file's). */
export const StoredNote = Note.omit({ item: true });
export const NotesFile = z.strictObject({
  item: NoteItemRef,
  notes: z.array(StoredNote),
});
export type NotesFile = z.output<typeof NotesFile>;

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}
