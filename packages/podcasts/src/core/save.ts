/**
 * `episode save` semantics (DESIGN.md §5), Node only. The single validated
 * write path for user/agent content: CLI, server and skills all go through
 * `saveEpisode`.
 */
import { createHash } from "node:crypto";
import { ConflictError, TranscriptGuardError, ValidationError } from "./errors";
import { assertSlug } from "./paths";
import {
  SAVE_FIELDS,
  SaveEpisodeInput,
  formatIssues,
  type Conversation,
  type Episode,
  type ParsedSaveEpisodeInput,
  type SaveField,
} from "./schema";
import {
  readConversations,
  readEpisode,
  readTranscriptIfExists,
  withLock,
  writeConversations,
  writeEpisode,
} from "./store";
import {
  MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT,
  TRANSCRIPT_EXCERPT_MIN_WORDS,
  buildTranscriptIndex,
  findTranscriptExcerpts,
  redactTranscriptExcerpts,
  utf8ByteLength,
  type TranscriptIndex,
} from "./transcript-guard";

export interface SaveEpisodeOptions {
  /** If given and different from the file's `updatedAt`, the save is rejected with `ConflictError`. */
  expectedUpdatedAt?: string;
  /** Clock override (tests). */
  now?: Date;
}

export interface SaveEpisodeResult {
  /** The episode after the save (unchanged if `written` is false). */
  episode: Episode;
  /** False when the input changed nothing (no file written, `updatedAt` unchanged). */
  written: boolean;
  /** Fields whose value actually changed. */
  changedFields: SaveField[];
  conversations: {
    added: number;
    /** Already stored (same markdown hash) or repeated within the input. */
    skipped: number;
    /** Transcript excerpts replaced by the placeholder in the added conversations. */
    excerptsRemoved: number;
  };
  /** Whether a local transcript was available for the guard (otherwise the size limit applied). */
  transcriptChecked: boolean;
}

/** Validates raw input (e.g. parsed JSON from `--input`) and returns the normalised form. Throws `ValidationError`. */
export function parseSaveInput(input: unknown): ParsedSaveEpisodeInput {
  const result = SaveEpisodeInput.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      `invalid save input (allowed keys: ${[...SAVE_FIELDS, "conversations"].join(", ")})`,
      formatIssues(result.error),
    );
  }
  return result.data;
}

/** Line endings normalised to LF, outer whitespace trimmed: the stored and hashed form of a conversation. */
export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

export function markdownHash(markdown: string): string {
  return createHash("sha256").update(normalizeMarkdown(markdown)).digest("hex");
}

function conversationDate(date: string | undefined, now: Date): string {
  if (date === undefined) return now.toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : new Date(date).toISOString();
}

function guardFields(index: TranscriptIndex, input: ParsedSaveEpisodeInput): string[] {
  const problems: string[] = [];
  const check = (field: string, text: string) => {
    for (const span of findTranscriptExcerpts(index, text)) {
      problems.push(
        `${field}: ${span.wordCount} consecutive words from the transcript, starting "${span.preview}"`,
      );
    }
  };
  input.summary?.forEach((point, i) => check(`summary[${i}]`, point));
  if (input.notes !== undefined) check("notes", input.notes);
  return problems;
}

/**
 * Applies `input` to episode `slug`:
 * - summary / notes / tags / guests present in the input overwrite; absent ones stay unchanged;
 * - conversations are appended, skipping any whose markdown hash is already stored
 *   (so re-running the same input adds nothing); transcript excerpts in them are
 *   replaced by `[estratto della trascrizione rimosso]`;
 * - transcript excerpts (≥ 20 consecutive words) in summary/notes → `TranscriptGuardError`;
 * - without a local transcript, a conversation over 200 KB → `TranscriptGuardError`;
 * - `expectedUpdatedAt` different from the file's → `ConflictError`;
 * - invalid input → `ValidationError`; unknown episode → `NotFoundError`.
 * Nothing is written if any check fails, or if nothing changes.
 */
export async function saveEpisode(
  slug: string,
  input: unknown,
  options: SaveEpisodeOptions = {},
): Promise<SaveEpisodeResult> {
  assertSlug(slug, "episode slug");
  const parsed = parseSaveInput(input);

  return withLock(`episode:${slug}`, async () => {
    const now = options.now ?? new Date();
    const episode = await readEpisode(slug);
    if (
      options.expectedUpdatedAt !== undefined &&
      options.expectedUpdatedAt !== episode.updatedAt
    ) {
      throw new ConflictError(slug, options.expectedUpdatedAt, episode.updatedAt);
    }

    const transcript = await readTranscriptIfExists(slug);
    const index = transcript ? buildTranscriptIndex(transcript) : undefined;

    if (index) {
      const problems = guardFields(index, parsed);
      if (problems.length > 0) {
        throw new TranscriptGuardError(
          `summary/notes contain transcript excerpts (${TRANSCRIPT_EXCERPT_MIN_WORDS}+ consecutive words): paraphrase them or keep quotes under ${TRANSCRIPT_EXCERPT_MIN_WORDS} words`,
          problems,
        );
      }
    }

    // Conversations: dedupe, then redact (or size-check) the ones to add.
    const stored = parsed.conversations?.length ? await readConversations(slug) : [];
    const knownHashes = new Set(stored.map((conversation) => markdownHash(conversation.markdown)));
    const toAdd: Conversation[] = [];
    let skipped = 0;
    let excerptsRemoved = 0;
    const oversized: string[] = [];
    for (const [i, conversation] of (parsed.conversations ?? []).entries()) {
      const raw = normalizeMarkdown(conversation.markdown);
      const rawHash = markdownHash(raw);
      const redacted = index ? redactTranscriptExcerpts(index, raw) : { text: raw, removed: 0 };
      const markdown = normalizeMarkdown(redacted.text);
      const hash = markdownHash(markdown);
      if (knownHashes.has(hash) || knownHashes.has(rawHash)) {
        skipped++;
        continue;
      }
      if (!index) {
        const bytes = utf8ByteLength(markdown);
        if (bytes > MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT) {
          oversized.push(
            `conversations[${i}]: ${Math.ceil(bytes / 1024)} KB, limit ${MAX_CONVERSATION_BYTES_WITHOUT_TRANSCRIPT / 1024} KB without a local transcript`,
          );
          continue;
        }
      }
      knownHashes.add(hash).add(rawHash);
      excerptsRemoved += redacted.removed;
      toAdd.push({
        date: conversationDate(conversation.date, now),
        agent: conversation.agent,
        markdown,
      });
    }
    if (oversized.length > 0) {
      throw new TranscriptGuardError(
        "conversation too large to save without a local transcript to check it against (it may contain the transcript)",
        oversized,
      );
    }

    const changes: Partial<Pick<Episode, SaveField>> = {};
    const changedFields: SaveField[] = [];
    for (const field of SAVE_FIELDS) {
      const value = parsed[field];
      if (value === undefined) continue;
      if (JSON.stringify(value) !== JSON.stringify(episode[field])) {
        Object.assign(changes, { [field]: value });
        changedFields.push(field);
      }
    }

    const result = {
      changedFields,
      conversations: { added: toAdd.length, skipped, excerptsRemoved },
      transcriptChecked: index !== undefined,
    };
    if (changedFields.length === 0 && toAdd.length === 0)
      return { ...result, episode, written: false };

    // Conversations first: if the episode write then fails, re-running dedupes them.
    if (toAdd.length > 0) await writeConversations(slug, [...stored, ...toAdd]);
    const updated = await writeEpisode({ ...episode, ...changes }, { now });
    return { ...result, episode: updated, written: true };
  });
}
