/** Bulk edit payload builder (pure, unit-tested). */
import type { BulkPatch } from "../../../shared/api.ts";
import type { BookStatus } from "../../../shared/schema.ts";
import { addTags, foldTag } from "./tags.ts";

export interface BulkFormState {
  /** "" = leave unchanged. */
  topic: string;
  /** "" = leave unchanged. */
  status: BookStatus | "";
  addTags: string[];
  removeTags: string[];
}

export const EMPTY_BULK: BulkFormState = { topic: "", status: "", addTags: [], removeTags: [] };

/** `null` when nothing would change. A tag both added and removed is dropped from "remove" (add wins). */
export function buildBulkPatch(state: BulkFormState): BulkPatch | null {
  const patch: BulkPatch = {};
  if (state.topic !== "") patch.topic = state.topic;
  if (state.status !== "") patch.status = state.status;
  const add = addTags([], state.addTags.join(","));
  const addKeys = new Set(add.map(foldTag));
  const remove = addTags([], state.removeTags.join(",")).filter((t) => !addKeys.has(foldTag(t)));
  if (add.length > 0) patch.addTags = add;
  if (remove.length > 0) patch.removeTags = remove;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Italian one-line description of a bulk patch, for the confirmation line. */
export function describeBulkPatch(
  patch: BulkPatch,
  labels: { topic: (id: string) => string; status: (s: BookStatus) => string },
): string[] {
  const lines: string[] = [];
  if (patch.topic !== undefined) lines.push(`argomento: ${labels.topic(patch.topic)}`);
  if (patch.status !== undefined) lines.push(`stato: ${labels.status(patch.status)}`);
  if (patch.addTags?.length) lines.push(`aggiungi tag: ${patch.addTags.join(", ")}`);
  if (patch.removeTags?.length) lines.push(`rimuovi tag: ${patch.removeTags.join(", ")}`);
  return lines;
}
