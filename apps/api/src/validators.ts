/** What each table may hold: the Zod schemas the packages already use. A write that does not match is refused. */
import type { ZodType } from "zod";
import { Exploration } from "@ehub/explore/schema";
import { QueueEntrySchema } from "@ehub/library/kobo";
import {
  BookHighlightsSchema,
  BookSchema,
  BookSummarySchema,
  TopicsFileSchema,
} from "@ehub/library/schema";
import { NotesFile } from "@ehub/notes/schema";
import { ConversationsFile, Episode, Show } from "@ehub/podcasts/schema";

export const TABLE_SCHEMAS: Record<string, ZodType> = {
  books: BookSchema,
  book_summaries: BookSummarySchema,
  book_highlights: BookHighlightsSchema,
  topics: TopicsFileSchema,
  shows: Show,
  episodes: Episode,
  conversations: ConversationsFile,
  notes: NotesFile,
  explorations: Exploration,
  kobo_queue: QueueEntrySchema,
};
