/**
 * Editor drafts, kept in `sessionStorage` per episode so that a page reload
 * (Vite reloads when a data file changes, e.g. a skill saved from the CLI)
 * never loses typed text. Cleared after a successful save.
 */
import { readJson, removeKey, writeJson } from "./storage";

export interface EditorValues {
  /** One summary point per line. */
  summary: string;
  notes: string;
  tags: string[];
  guests: string[];
}

export interface EditorDraft extends EditorValues {
  /** `updatedAt` of the episode version the draft started from. */
  baseUpdatedAt: string;
  /** The values of that version: tells which fields the user actually touched. */
  base: EditorValues;
}

const key = (slug: string) => `e-podcasts-dev:draft:${slug}`;

export function loadDraft(slug: string): EditorDraft | undefined {
  const draft = readJson<Partial<EditorDraft>>(key(slug));
  if (
    !draft ||
    typeof draft.baseUpdatedAt !== "string" ||
    typeof draft.summary !== "string" ||
    typeof draft.notes !== "string" ||
    !Array.isArray(draft.tags) ||
    !Array.isArray(draft.guests) ||
    !draft.base
  ) {
    return undefined;
  }
  return draft as EditorDraft;
}

export function saveDraft(slug: string, draft: EditorDraft): void {
  writeJson(key(slug), draft);
}

export function clearDraft(slug: string): void {
  removeKey(key(slug));
}

export function sameValues(a: EditorValues, b: EditorValues): boolean {
  return (
    a.summary === b.summary &&
    a.notes === b.notes &&
    a.tags.join("\n") === b.tags.join("\n") &&
    a.guests.join("\n") === b.guests.join("\n")
  );
}

export function valuesOf(episode: {
  summary: readonly string[];
  notes: string;
  tags: readonly string[];
  guests: readonly string[];
}): EditorValues {
  return {
    summary: episode.summary.join("\n"),
    notes: episode.notes,
    tags: [...episode.tags],
    guests: [...episode.guests],
  };
}

/** Splits the summary textarea into points (blank lines dropped). */
export function summaryPoints(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Starting state of the editor: the saved episode, or the stored draft. A
 * draft started from an older version (the file changed meanwhile) keeps the
 * fields the user touched and takes the rest from the current version, so
 * saving never silently reverts what someone else wrote.
 */
export function startingState(
  episode: Parameters<typeof valuesOf>[0] & { updatedAt: string },
  draft: EditorDraft | undefined,
): EditorDraft {
  const saved = valuesOf(episode);
  if (!draft) return { ...saved, baseUpdatedAt: episode.updatedAt, base: saved };
  if (draft.baseUpdatedAt === episode.updatedAt) return draft;
  const fields = ["summary", "notes", "tags", "guests"] as const;
  const merged = { ...saved, baseUpdatedAt: draft.baseUpdatedAt, base: { ...draft.base } };
  for (const field of fields) {
    const touched = !sameValues(
      { ...saved, [field]: draft[field] } as EditorValues,
      { ...saved, [field]: draft.base[field] } as EditorValues,
    );
    if (touched) (merged as Record<string, unknown>)[field] = draft[field];
    else (merged.base as Record<string, unknown>)[field] = saved[field];
  }
  // Nothing of the draft differs from the current version any more: start clean.
  if (sameValues(merged, saved)) return { ...saved, baseUpdatedAt: episode.updatedAt, base: saved };
  return merged;
}
