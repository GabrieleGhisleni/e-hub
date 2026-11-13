/**
 * Italian labels of the verdicts. Zod-free on purpose: the browser bundle imports these labels, and it must not
 * pull the schema library in just for text. `schema.ts` re-exports both names.
 */
export type VerdictDecision = "all" | "parts" | "skip" | "undecided";

/** The part of a verdict the labels need (a decision and, for "parts", its chapters). */
export interface VerdictLabelInput {
  decision: VerdictDecision;
  chapters?: readonly number[];
}

export const VERDICT_LABELS: Readonly<Record<VerdictDecision, string>> = {
  all: "Leggere tutto",
  parts: "Leggere in parte",
  skip: "Non leggere",
  undecided: "Da decidere",
};

/** "Leggere i capitoli 2 e 5", "Leggere il capitolo 3", "Da decidere" when there is no verdict. */
export function formatVerdict(verdict: VerdictLabelInput | null | undefined): string {
  if (!verdict) return VERDICT_LABELS.undecided;
  if (verdict.decision !== "parts") return VERDICT_LABELS[verdict.decision];
  const chapters = verdict.chapters ?? [];
  if (chapters.length === 0) return VERDICT_LABELS.parts;
  if (chapters.length === 1) return `Leggere il capitolo ${chapters[0]}`;
  const head = chapters.slice(0, -1).join(", ");
  const last = chapters[chapters.length - 1];
  return `Leggere i capitoli ${head} e ${last}`;
}
