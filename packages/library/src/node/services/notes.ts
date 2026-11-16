/** General notes of a book (`notes.md`): the service behind `PUT /api/library/books/:id/notes`. */
import {
  type SaveNotesRequest,
  SaveNotesRequestSchema,
  type SaveNotesResponse,
} from "../../shared/api.ts";
import { readBookMarkdown, writeBookMarkdown } from "../repo/index.ts";
import type { ServiceContext } from "./context.ts";
import { loadBook, parseInput } from "./internal.ts";

/** Replaces `notes.md`. `written` is false when the text is the one already saved. */
export async function saveBookNotes(
  ctx: ServiceContext,
  id: string,
  request: SaveNotesRequest,
): Promise<SaveNotesResponse> {
  const { notes } = parseInput(SaveNotesRequestSchema, request, "appunti");
  await loadBook(ctx, id);
  const current = await readBookMarkdown(ctx.dataDir, id, "notes");
  if ((current ?? "").trim() === notes.trim()) return { written: false };
  await writeBookMarkdown(ctx.dataDir, id, "notes", notes);
  return { written: true };
}
