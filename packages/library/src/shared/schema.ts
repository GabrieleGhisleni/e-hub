import { z } from "zod";
import { BOOK_ID_PATTERN, TOPIC_ID_MAX_LENGTH, TOPIC_ID_PATTERN } from "./ids.ts";
import { UNSORTED_TOPIC_ID } from "./labels.ts";
import { topicFolderName } from "./naming.ts";

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export const BOOK_STATUSES = ["to-read", "reading", "read", "abandoned"] as const;
export const BookStatusSchema = z.enum(BOOK_STATUSES);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const BookIdSchema = z
  .string()
  .regex(BOOK_ID_PATTERN, "must be 8 lowercase Crockford base32 characters");

export const TopicIdSchema = z
  .string()
  .max(TOPIC_ID_MAX_LENGTH)
  .regex(TOPIC_ID_PATTERN, "must be a lowercase ASCII slug (a-z, 0-9, '-')");

/** A string with at least one non-whitespace character. Not trimmed: parsing never rewrites values. */
export const NonBlankStringSchema = z
  .string()
  .refine((s) => s.trim().length > 0, { message: "must not be blank" });

/** Calendar date `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();

// ---------------------------------------------------------------------------------------------
// book.json
// ---------------------------------------------------------------------------------------------

/**
 * `book.json`, "soft" schema (PLAN §5): required id/title/authors/topic/status, every other known field
 * optional, unknown keys kept as they are (loose object). Never put file IDs, paths or hashes here.
 */
export const BookSchema = z.looseObject({
  id: BookIdSchema,
  title: NonBlankStringSchema,
  /** Display form ("Daniel Kahneman"); the first one names the file on the Kobo. */
  authors: z.array(NonBlankStringSchema).min(1),
  /** Topic ID from topics.json. */
  topic: TopicIdSchema,
  status: BookStatusSchema,
  tags: z.array(NonBlankStringSchema).optional(),
  startedAt: IsoDateSchema.optional(),
  finishedAt: IsoDateSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  isbn: z.string().optional(),
  openLibraryCoverId: z.number().int().positive().optional(),
  publisher: z.string().optional(),
  /** Year of publication (of this edition), e.g. 2011. */
  year: z.number().int().min(1).max(2200).optional(),
  /** Number of pages of the printed edition, when known (Z-Library reports it; EPUBs do not). */
  pages: z.number().int().min(1).max(100000).optional(),
  /** Translators, display form, when the book is a translation. */
  translators: z.array(NonBlankStringSchema).optional(),
  /** BCP 47 tag as found in the EPUB (e.g. "it", "en-US"). */
  language: z.string().optional(),
  description: z.string().optional(),
  /** Original `dc:subject` values from the EPUB. */
  subjects: z.array(z.string()).optional(),
});
export type Book = z.infer<typeof BookSchema>;

/** Canonical key order used when writing book.json; unknown keys follow in their original order. */
export const BOOK_KEY_ORDER = [
  "id",
  "title",
  "authors",
  "topic",
  "status",
  "tags",
  "startedAt",
  "finishedAt",
  "rating",
  "isbn",
  "openLibraryCoverId",
  "publisher",
  "year",
  "pages",
  "translators",
  "language",
  "description",
  "subjects",
] as const satisfies readonly (keyof typeof BookSchema.shape)[];
export type KnownBookKey = (typeof BOOK_KEY_ORDER)[number];

// ---------------------------------------------------------------------------------------------
// topics.json
// ---------------------------------------------------------------------------------------------

/** One controlled topic. `id` never changes after creation; `label` (Italian) is the book's series on the Kobo. */
export const TopicSchema = z.looseObject({
  id: TopicIdSchema,
  label: NonBlankStringSchema,
});
export type Topic = z.infer<typeof TopicSchema>;

/**
 * topics.json is a JSON array (display order). IDs are unique, `unsorted` is always present, and two
 * labels may not map to the same folder-safe name (compared case-insensitively, as FAT32 does).
 */
export const TopicsFileSchema = z.array(TopicSchema).superRefine((topics, ctx) => {
  const ids = new Set<string>();
  const folders = new Map<string, string>();
  topics.forEach((topic, index) => {
    if (ids.has(topic.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `duplicate topic id "${topic.id}"`,
      });
    }
    ids.add(topic.id);
    const folder = topicFolderName(topic.label).toLowerCase();
    const clash = folders.get(folder);
    if (clash !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [index, "label"],
        message: `label "${topic.label}" looks the same as topic "${clash}"`,
      });
    } else {
      folders.set(folder, topic.id);
    }
  });
  if (!ids.has(UNSORTED_TOPIC_ID)) {
    ctx.addIssue({
      code: "custom",
      path: [],
      message: `the "${UNSORTED_TOPIC_ID}" topic is required`,
    });
  }
});
export type TopicsFile = z.infer<typeof TopicsFileSchema>;

// ---------------------------------------------------------------------------------------------
// Book summary (`data/books/<id>/summary.json`, generated by `elib summarize`, docs/chat.md §4)
// ---------------------------------------------------------------------------------------------

export const BOOK_SUMMARY_VERSION = 1;

/** One chapter of `summary.json`. `summary` is null for chapters too short to summarize (cover, copyright, index…). */
export const ChapterSummarySchema = z.object({
  /** Chapter number as in the `elib text` manifest (1-based). */
  n: z.number().int().positive(),
  title: z.string(),
  words: z.number().int().nonnegative(),
  summary: z.string().trim().min(1).nullable(),
});
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;

/**
 * `summary.json`: LLM-written summaries of the book and of each chapter, in the model's own words (published, so no
 * long quotes). `language` is the one chosen by the caller (e.g. "it"), not necessarily the book's.
 */
export const BookSummarySchema = z.object({
  version: z.literal(BOOK_SUMMARY_VERSION),
  bookId: BookIdSchema,
  generatedAt: z.iso.datetime(),
  /** Model that wrote it: the router's `x-router-model` when known, otherwise the configured model (e.g. "smart"). */
  model: z.string().min(1),
  language: z.string().min(2).max(10),
  book: z.string().trim().min(1),
  chapters: z.array(ChapterSummarySchema),
});
export type BookSummary = z.infer<typeof BookSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Highlights (`data/books/<id>/highlights.json`, pulled from the Kobo's KOReader sidecar by `elib sync`)
// ---------------------------------------------------------------------------------------------

export const BOOK_HIGHLIGHTS_VERSION = 1;

/** One passage highlighted on the Kobo, with the reader's comment when there is one. */
export const HighlightSchema = z.object({
  text: z.string().trim().min(1),
  /** The note typed on the Kobo for this highlight. */
  note: z.string().trim().min(1).optional(),
  /** Chapter title as KOReader shows it (from the book's table of contents). */
  chapter: z.string().optional(),
  /** Page number on the Kobo when the highlight was made (depends on font and layout: an indication, not a citation). */
  page: z.number().int().positive().optional(),
  /** KOReader position of the start (XPointer): keeps the reading order and tells highlights apart. */
  pos: z.string().optional(),
  /** When it was made, as KOReader writes it ("2026-11-11 22:01:06", device local time). */
  createdAt: z.string().optional(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

/** `highlights.json`: the highlights of a book in reading order (the order of the book, not of creation). */
export const BookHighlightsSchema = z.object({
  version: z.literal(BOOK_HIGHLIGHTS_VERSION),
  bookId: BookIdSchema,
  /** Last time the list changed. */
  syncedAt: z.iso.datetime(),
  highlights: z.array(HighlightSchema),
});
export type BookHighlights = z.infer<typeof BookHighlightsSchema>;

/** What the book page shows of a highlight. */
export const PublicHighlightSchema = HighlightSchema.pick({ text: true, note: true, chapter: true, page: true });
export type PublicHighlight = z.infer<typeof PublicHighlightSchema>;

// ---------------------------------------------------------------------------------------------
// Site data (generated by W2c, read by the SPA)
// ---------------------------------------------------------------------------------------------

/** One entry of `index.json`: only what the grid, the filters and the search need. */
export const BookCardSchema = z.object({
  id: BookIdSchema,
  /** `bookSlug(book)`, for readable URLs only. */
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  pages: z.number().int().optional(),
  publisher: z.string().optional(),
  topic: TopicIdSchema,
  status: BookStatusSchema,
  tags: z.array(z.string()),
  rating: z.number().int().min(1).max(5).optional(),
  startedAt: IsoDateSchema.optional(),
  finishedAt: IsoDateSchema.optional(),
  /** Hashed cover URL as served (`<base>data/covers/<id>.<hash>.webp`), or null when the book has no cover.webp. */
  coverUrl: z.string().nullable(),
});
export type BookCard = z.infer<typeof BookCardSchema>;

/** `books/<id>.json`: card fields + the remaining metadata + the Markdown files already rendered to HTML. */
export const BookDetailSchema = BookCardSchema.extend({
  isbn: z.string().optional(),
  openLibraryCoverId: z.number().int().positive().optional(),
  translators: z.array(z.string()).optional(),
  language: z.string().optional(),
  description: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  notesHtml: z.string().nullable(),
  recallHtml: z.string().nullable(),
  studyHtml: z.string().nullable(),
  /** From `summary.json`, or null when the book has not been summarized yet. */
  summary: z
    .object({
      language: z.string(),
      model: z.string(),
      generatedAt: z.string(),
      book: z.string(),
      chapters: z.array(ChapterSummarySchema.pick({ n: true, title: true, summary: true })),
    })
    .nullable(),
  /** From `highlights.json`, in reading order. Absent when the book has none. */
  highlights: z.array(PublicHighlightSchema).optional(),
});
export type BookDetail = z.infer<typeof BookDetailSchema>;

/** `index.json`. */
export const SiteIndexSchema = z.object({
  topics: z.array(z.object({ id: TopicIdSchema, label: z.string() })),
  books: z.array(BookCardSchema),
});
export type SiteIndex = z.infer<typeof SiteIndexSchema>;
