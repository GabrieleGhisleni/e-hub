import type { BookStatus } from "./schema.ts";

/** The special topic every library has: books imported in bulk and not yet classified. Never deletable. */
export const UNSORTED_TOPIC_ID = "unsorted";
export const UNSORTED_TOPIC_LABEL = "Da smistare";

/** Italian UI labels for the status enum (sentence case, ready for buttons and badges). */
export const STATUS_LABELS: Readonly<Record<BookStatus, string>> = {
  "to-read": "Da leggere",
  reading: "In lettura",
  read: "Letto",
  abandoned: "Abbandonato",
};

export function statusLabel(status: BookStatus): string {
  return STATUS_LABELS[status];
}
