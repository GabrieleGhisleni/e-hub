/**
 * Validation of explorations (Zod 4). Isomorphic: the browser imports only types from here (labels come from the
 * zod-free `labels.ts`). The server and the CLI validate every write and every file on disk with these schemas.
 * No Node APIs in this file.
 */
import { z } from "zod";

export const MAX_TITLE_LENGTH = 200;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_SUMMARY_LENGTH = 5000;
export const MAX_NOTE_LENGTH = 20_000;
export const MAX_JOURNAL_LENGTH = 5000;
export const MAX_NOTEBOOK_LENGTH = 100_000;
export const MAX_SOURCES = 30;
export const MAX_EPUB_BYTES = 100 * 1024 * 1024;

/** Exploration IDs become file names: `YYYY-MM-DD-slug`, lowercase ASCII only. */
export const ExplorationId = z
  .string()
  .max(120)
  .regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/, "ID non valido");

/** Same format as the library book IDs (Crockford base32, 8 characters). */
export const BookId = z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/, "ID libro non valido");

export const Via = z.enum(["skill", "app", "cli"]);
export type Via = z.output<typeof Via>;

export const Instant = z.iso.datetime();

export const ExplorationStatus = z.enum(["open", "closed"]);
export type ExplorationStatus = z.output<typeof ExplorationStatus>;

export const VerdictDecision = z.enum(["all", "parts", "skip", "undecided"]);
export type VerdictDecision = z.output<typeof VerdictDecision>;

export const Reason = z
  .string()
  .trim()
  .min(1, "La motivazione è vuota")
  .max(500, "La motivazione supera 500 caratteri")
  .refine((text) => !/[\r\n]/.test(text), "La motivazione deve stare su una riga");

/** Chapter numbers: integers from 1, at least one, stored unique and ascending (input is normalised). */
export const Chapters = z
  .array(z.int().min(1, "I capitoli partono da 1"))
  .min(1, "Indica almeno un capitolo")
  .transform((chapters) => [...new Set(chapters)].sort((a, b) => a - b));

const VerdictCommon = {
  reason: Reason,
  decidedAt: Instant,
  via: Via,
};

/** What the reader decided for one source. `null` on a source means no decision yet. */
export const Verdict = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("all"), ...VerdictCommon }),
  z.strictObject({ decision: z.literal("skip"), ...VerdictCommon }),
  z.strictObject({ decision: z.literal("undecided"), ...VerdictCommon }),
  z.strictObject({ decision: z.literal("parts"), chapters: Chapters, ...VerdictCommon }),
]);
export type Verdict = z.output<typeof Verdict>;

export const EpubFile = z.strictObject({
  fileName: z.string().min(1).max(300),
  md5: z.string().regex(/^[a-f0-9]{32}$/, "MD5 non valido"),
  bytes: z.int().positive(),
});
export type EpubFile = z.output<typeof EpubFile>;

const Name = z.string().trim().min(1).max(200);

/**
 * A book in an exploration. `library`: a book already in the library (its text comes from `elib text`).
 * `explore`: an EPUB uploaded only to explore it; it has an `epub` record and never enters the library.
 */
export const BookSource = z
  .strictObject({
    kind: z.literal("book"),
    id: BookId,
    origin: z.enum(["library", "explore"]),
    title: z.string().trim().min(1).max(500),
    authors: z.array(Name).max(20),
    language: z.string().min(1).max(35).optional(),
    epub: EpubFile.optional(),
    addedAt: Instant,
    verdict: Verdict.nullable(),
  })
  .refine((source) => (source.origin === "explore") === (source.epub !== undefined), {
    message: "L'EPUB è obbligatorio solo per i libri esplorati (origine explore)",
    path: ["epub"],
  });
export type BookSource = z.output<typeof BookSource>;

export const Note = z.strictObject({
  id: z.uuid(),
  body: z.string().trim().min(1, "La nota è vuota").max(MAX_NOTE_LENGTH),
  book: BookId.optional(),
  createdAt: Instant,
  updatedAt: Instant,
  via: Via,
});
export type Note = z.output<typeof Note>;

export const JournalEntry = z.strictObject({
  at: Instant,
  via: Via,
  text: z.string().trim().min(1, "La voce del diario è vuota").max(MAX_JOURNAL_LENGTH),
});
export type JournalEntry = z.output<typeof JournalEntry>;

/** The exploration's notebook: one Markdown document shared by the reader and Claude. Absent means empty. */
export const Notebook = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1, "Il quaderno è vuoto")
    .max(MAX_NOTEBOOK_LENGTH, `Il quaderno supera ${MAX_NOTEBOOK_LENGTH} caratteri`),
  updatedAt: Instant,
  via: Via,
});
export type Notebook = z.output<typeof Notebook>;

/** A tag of an exploration (e.g. "filosofia"): lowercase, one line, no commas. Duplicates are dropped. */
export const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Il tag è vuoto")
  .max(40, "Il tag supera 40 caratteri")
  .regex(/^[^,\r\n]+$/, "Il tag non può contenere virgole né andare a capo");
export const MAX_TAGS = 10;
export const Tags = z
  .array(Tag)
  .max(MAX_TAGS, `Al massimo ${MAX_TAGS} tag`)
  .transform((tags) => [...new Set(tags)].sort((a, b) => a.localeCompare(b, "it")));

export const Exploration = z
  .strictObject({
    version: z.literal(1),
    id: ExplorationId,
    title: z.string().trim().min(1, "Il titolo è vuoto").max(MAX_TITLE_LENGTH),
    question: z.string().trim().min(1, "La domanda è vuota").max(MAX_QUESTION_LENGTH),
    status: ExplorationStatus,
    /** Free labels to group explorations (e.g. to send the books of all "filosofia" explorations to the Kobo). */
    tags: Tags.optional(),
    createdAt: Instant,
    updatedAt: Instant,
    sources: z
      .array(BookSource)
      .max(MAX_SOURCES, `Al massimo ${MAX_SOURCES} fonti per esplorazione`)
      .refine(
        (sources) => new Set(sources.map((s) => s.id)).size === sources.length,
        "Lo stesso libro compare due volte",
      ),
    summary: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH).nullable(),
    notes: z.array(Note),
    notebook: Notebook.optional(),
    journal: z.array(JournalEntry),
  })
  .refine(
    (exploration) =>
      exploration.notes.every(
        (note) => note.book === undefined || exploration.sources.some((s) => s.id === note.book),
      ),
    { message: "Una nota si riferisce a un libro che non è una fonte", path: ["notes"] },
  );
export type Exploration = z.output<typeof Exploration>;
export type ExplorationSource = BookSource;

// Labels live in the zod-free `labels.ts` (the web bundle imports them); re-exported here for the server and CLI.
export { VERDICT_LABELS, formatVerdict } from "./labels.ts";

/**
 * The ID of a new exploration before the collision check: local date plus an ASCII slug of the title
 * (lowercase, no accents, at most 60 characters). The repo adds `-2`, `-3`… when the ID is taken.
 */
export function explorationIdFor(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${day}-${slug || "esplorazione"}`;
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}
