import type { BookSource, ExplorationStatus } from "../schema.ts";

/** Who wrote something (journal entries, the notebook), as the reader sees it. */
export const VIA_LABELS = { skill: "Dalla skill", app: "Dall'app", cli: "Da terminale" } as const;

export const STATUS_LABELS: Readonly<Record<ExplorationStatus, string>> = {
  open: "Aperta",
  closed: "Chiusa",
};

/** Where a source comes from, as the reader sees it. */
export const ORIGIN_LABELS: Readonly<Record<BookSource["origin"], string>> = {
  library: "Dalla libreria",
  explore: "Solo da esplorare",
};

/** "12 novembre 2026" (Italian), for dates stored as ISO instants. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

export const explorationHref = (id: string) => `/explore/${encodeURIComponent(id)}`;

/** The library's own page for a book (the route resolves without the slug). */
export const libraryBookHref = (id: string) => `/library/book/${encodeURIComponent(id)}`;

/** The text of a badge: `Esplorato in: «titolo» — Leggere i capitoli 2 e 5`. */
export function explorationBadgeText(title: string, verdictLabel: string): string {
  return `Esplorato in: «${title}» — ${verdictLabel}`;
}
