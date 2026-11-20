/**
 * Data contracts (DESIGN.md §4). Isomorphic: imports nothing but `zod`, because
 * the web bundle imports it. Node-only code (storage) lives in other modules.
 *
 * Every entity has a free `extra` record so the data can grow without losing
 * validation. Entity objects are strict: an unknown key is a validation error
 * (put new free-form data under `extra`).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives

/** Max length of any show/episode slug. Generated episode slugs are shorter (see slug.ts). */
export const SLUG_MAX_LENGTH = 100;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Show and episode slugs: used as file names and URL segments. */
export const Slug = z
  .string()
  .max(SLUG_MAX_LENGTH, `slug must be at most ${SLUG_MAX_LENGTH} characters`)
  .regex(
    SLUG_PATTERN,
    "slug must match ^[a-z0-9]+(-[a-z0-9]+)*$ (lowercase, digits, single hyphens)",
  );
export type Slug = z.infer<typeof Slug>;

export function isValidSlug(value: string): boolean {
  return Slug.safeParse(value).success;
}

export const TAG_MAX_LENGTH = 40;
export const TAG_PATTERN = SLUG_PATTERN;

/** A tag as stored: English, lowercase, kebab-case (DESIGN.md §4.5). */
export const Tag = z
  .string()
  .max(TAG_MAX_LENGTH, `tag must be at most ${TAG_MAX_LENGTH} characters`)
  .regex(
    TAG_PATTERN,
    "tag must be lowercase letters/digits separated by single hyphens (e.g. 'sleep', 'machine-learning')",
  );
export type Tag = z.infer<typeof Tag>;

/**
 * Normalises one tag the way `episode save` does: trim, lowercase, runs of
 * whitespace/underscores become a hyphen. The result still has to match `Tag`
 * (e.g. "C++" stays invalid).
 */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/** Normalises and dedupes tags, keeping the first occurrence's position. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag))];
}

/** Free-form record present on every entity. */
export const Extra = z.record(z.string(), z.unknown());
export type Extra = z.infer<typeof Extra>;

/** Absolute http(s) URL. */
export const HttpUrl = z.url({ protocol: /^https?$/, error: "must be an absolute http(s) URL" });

/** Calendar date `YYYY-MM-DD`. */
export const IsoDate = z.iso.date({ error: "must be a date in YYYY-MM-DD format" });

/** ISO 8601 UTC datetime as produced by `Date.prototype.toISOString()` (e.g. `2026-11-09T10:15:00.000Z`). */
export const IsoDateTime = z.iso.datetime({
  error: "must be an ISO 8601 UTC datetime (e.g. 2026-11-09T10:15:00.000Z)",
});

/** YouTube video id (11 chars). */
export const YoutubeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, "must be an 11-character YouTube video id");

const NonEmptyText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} must not be empty`)
    .max(max, `${what} must be at most ${max} characters`);

// ---------------------------------------------------------------------------
// Transcript enums

export const TRANSCRIPT_SOURCES = [
  "lex-official",
  "patrykwajs-wiki",
  "whisper-local",
  "askchannel",
] as const;
export const TranscriptSource = z.enum(TRANSCRIPT_SOURCES);
export type TranscriptSource = z.infer<typeof TranscriptSource>;

/** Which audio the timestamps are measured on (DESIGN.md §4.3): only `youtube` allows YouTube deep links. */
export const TIMEBASES = ["youtube", "feed"] as const;
export const Timebase = z.enum(TIMEBASES);
export type Timebase = z.infer<typeof Timebase>;

// ---------------------------------------------------------------------------
// Show — data/shows/<slug>.json

export const ShowLinks = z.strictObject({
  website: HttpUrl.optional(),
  youtube: HttpUrl.optional(),
});
export type ShowLinks = z.infer<typeof ShowLinks>;

/** Path of a show image relative to the site base, e.g. `shows/lex-fridman.webp`. */
export const ShowImagePath = z
  .string()
  .regex(
    /^shows\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|png|jpg|jpeg)$/,
    "must be a path like 'shows/<slug>.webp'",
  );

export const Show = z.strictObject({
  slug: Slug,
  name: NonEmptyText(200, "name"),
  host: NonEmptyText(200, "host"),
  links: ShowLinks.default({}),
  /** oEmbed `author_url` of the YouTube channel (e.g. `https://www.youtube.com/@lexfridman`); ingest uses it to recognise the show. */
  youtubeAuthorUrl: HttpUrl.optional(),
  /** Podcast RSS feed (confirmed by hand, DESIGN.md §4.1). */
  feedUrl: HttpUrl.optional(),
  image: ShowImagePath.optional(),
  extra: Extra.default({}),
});
export type Show = z.infer<typeof Show>;
export type ShowInput = z.input<typeof Show>;

// ---------------------------------------------------------------------------
// Episode — data/episodes/<slug>.json

export const SUMMARY_MAX_POINTS = 10;
export const SUMMARY_POINT_MAX_LENGTH = 500;
export const NOTES_MAX_LENGTH = 200_000;
export const GUEST_MAX_LENGTH = 200;
export const GUEST_DESCRIPTION_MAX_LENGTH = 300;

/**
 * Summary = a list of short key points (DESIGN.md §4.2 asks for 3–5; the
 * schema allows 0..10 so a freshly added episode can have none). The list view
 * renders them compactly; agents produce exactly this array.
 */
export const Summary = z
  .array(NonEmptyText(SUMMARY_POINT_MAX_LENGTH, "summary point"))
  .max(SUMMARY_MAX_POINTS, `summary must have at most ${SUMMARY_MAX_POINTS} points`);
export type Summary = z.infer<typeof Summary>;

export const Guests = z
  .array(NonEmptyText(GUEST_MAX_LENGTH, "guest name"))
  .refine((guests) => new Set(guests).size === guests.length, "guests must not contain duplicates");

const GuestDescriptions = z.record(
  NonEmptyText(GUEST_MAX_LENGTH, "guest name"),
  NonEmptyText(GUEST_DESCRIPTION_MAX_LENGTH, "guest description"),
);

export const Tags = z
  .array(Tag)
  .refine((tags) => new Set(tags).size === tags.length, "tags must not contain duplicates");

export const Notes = z
  .string()
  .max(NOTES_MAX_LENGTH, `notes must be at most ${NOTES_MAX_LENGTH} characters`);

export const Episode = z
  .strictObject({
    slug: Slug,
    title: NonEmptyText(500, "title"),
    /** May be empty (many Huberman episodes have no guest). */
    guests: Guests.default([]),
    guestDescriptions: GuestDescriptions.optional(),
    /** Show slug (`data/shows/<show>.json`). */
    show: Slug,
    number: z.int().positive().optional(),
    /** Original link (the URL the episode was added from). */
    url: HttpUrl,
    youtubeId: YoutubeId.optional(),
    publishedAt: IsoDate.optional(),
    /** When the episode was added (= listened). Set automatically; `--added-at` only for the initial import. */
    addedAt: IsoDateTime,
    /** Set on every write; doubles as the version check of `episode save` (DESIGN.md §5). */
    updatedAt: IsoDateTime,
    /** Present iff there is a local transcript (data/transcripts/<slug>.json). */
    transcriptSource: TranscriptSource.optional(),
    /** Present iff there is a local transcript. */
    transcriptTimebase: Timebase.optional(),
    tags: Tags.default([]),
    summary: Summary.default([]),
    /** Markdown. */
    notes: Notes.default(""),
    extra: Extra.default({}),
  })
  .superRefine((episode, ctx) => {
    if ((episode.transcriptSource === undefined) !== (episode.transcriptTimebase === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["transcriptTimebase"],
        message: "transcriptSource and transcriptTimebase must be both present or both absent",
      });
    }
  });
export type Episode = z.infer<typeof Episode>;
export type EpisodeInput = z.input<typeof Episode>;

// ---------------------------------------------------------------------------
// Conversations — data/conversations/<slug>.json

export const AGENT_MAX_LENGTH = 100;

export const Conversation = z.strictObject({
  /** ISO datetime (UTC). */
  date: IsoDateTime,
  /** Free label of the agent, e.g. "claude.ai", "chatgpt", "claude-code". */
  agent: NonEmptyText(AGENT_MAX_LENGTH, "agent"),
  /** The chat as pasted, minus transcript excerpts (DESIGN.md §5.1). */
  markdown: z.string().min(1, "markdown must not be empty"),
});
export type Conversation = z.infer<typeof Conversation>;

/** File format: a plain JSON array, oldest first. A missing file means no conversations. */
export const ConversationsFile = z.array(Conversation);
export type ConversationsFile = z.infer<typeof ConversationsFile>;

// ---------------------------------------------------------------------------
// Transcript — data/transcripts/<slug>.json (gitignored, local only)

export const TranscriptSegment = z.strictObject({
  /** Display name ("Lex Fridman", "Guest Name"); absent when the source has no speakers (PatrykWajs). */
  speaker: NonEmptyText(200, "speaker").optional(),
  /** Seconds from the start of the audio named by `timebase`. */
  start: z.number().nonnegative(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const TranscriptChapter = z.strictObject({
  title: NonEmptyText(500, "chapter title"),
  start: z.number().nonnegative(),
});
export type TranscriptChapter = z.infer<typeof TranscriptChapter>;

export const AUDIO_SOURCES = ["youtube", "feed"] as const;
export const TranscriptAudio = z.strictObject({
  /** `youtube` = yt-dlp on the video (timebase youtube); `feed` = RSS enclosure (timebase feed). */
  source: z.enum(AUDIO_SOURCES),
  url: HttpUrl,
});
export type TranscriptAudio = z.infer<typeof TranscriptAudio>;

export const Transcript = z
  .strictObject({
    source: TranscriptSource,
    timebase: Timebase,
    /** Audio actually transcribed (whisper only, DESIGN.md §7.2). */
    audio: TranscriptAudio.optional(),
    /** Where the text came from (Lex transcript page, wiki file URL…), if any. */
    sourceUrl: HttpUrl.optional(),
    /** When this transcript was fetched/produced. */
    createdAt: IsoDateTime,
    /** In audio order. */
    segments: z.array(TranscriptSegment),
    chapters: z.array(TranscriptChapter).default([]),
    extra: Extra.default({}),
  })
  .superRefine((transcript, ctx) => {
    if (transcript.source === "whisper-local" && transcript.audio === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["audio"],
        message: "whisper-local transcripts must record the audio used",
      });
    }
    if (transcript.audio !== undefined && transcript.audio.source !== transcript.timebase) {
      ctx.addIssue({
        code: "custom",
        path: ["timebase"],
        message: `timebase must be '${transcript.audio.source}' when the audio comes from ${transcript.audio.source}`,
      });
    }
  });
export type Transcript = z.infer<typeof Transcript>;
export type TranscriptInput = z.input<typeof Transcript>;

// ---------------------------------------------------------------------------
// `episode save` input (DESIGN.md §5)

export const NewConversation = z.strictObject({
  /** `YYYY-MM-DD` or ISO datetime; defaults to now. Stored as ISO datetime. */
  date: z.union([IsoDateTime, IsoDate]).optional(),
  agent: NonEmptyText(AGENT_MAX_LENGTH, "agent"),
  markdown: z.string().trim().min(1, "markdown must not be empty"),
});
export type NewConversation = z.infer<typeof NewConversation>;

/**
 * Input of `saveEpisode` / `pnpm episode save --input`. Every field is
 * optional: present fields overwrite, absent ones stay unchanged. Tags are
 * normalised (trim, lowercase, spaces → hyphens) and deduped before
 * validation; guests are trimmed and deduped.
 */
export const SaveEpisodeInput = z.strictObject({
  summary: Summary.optional(),
  notes: Notes.optional(),
  tags: z
    .array(z.string())
    .transform((tags) => normalizeTags(tags))
    .pipe(z.array(Tag))
    .optional(),
  guests: z
    .array(NonEmptyText(GUEST_MAX_LENGTH, "guest name"))
    .transform((guests) => [...new Set(guests)])
    .optional(),
  guestDescriptions: GuestDescriptions.optional(),
  /** Appended; any whose markdown is already stored is skipped. */
  conversations: z.array(NewConversation).optional(),
});
export type SaveEpisodeInput = z.input<typeof SaveEpisodeInput>;
export type ParsedSaveEpisodeInput = z.output<typeof SaveEpisodeInput>;

/** Fields of the episode that `episode save` can overwrite. */
export const SAVE_FIELDS = ["summary", "notes", "tags", "guests", "guestDescriptions"] as const;
export type SaveField = (typeof SAVE_FIELDS)[number];

// ---------------------------------------------------------------------------
// Helpers

/**
 * Formats Zod issues as one readable line each: `- path: message`.
 * Used for every validation error shown to users and agents.
 */
export function formatIssues(error: z.ZodError, prefix = ""): string[] {
  return error.issues.map((issue) => {
    const path = [
      prefix,
      ...issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)),
    ]
      .join("")
      .replace(/^\./, "");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
