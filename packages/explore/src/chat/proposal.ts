/**
 * The verdicts the chat proposes with `propose_verdicts` (Italian messages). Isomorphic: the web UI parses the tool
 * input with the same schema and shows it for confirmation. Nothing here writes: the user saves the proposal.
 */
import { z } from "zod";
import { MAX_JOURNAL_LENGTH, MAX_SOURCES, MAX_SUMMARY_LENGTH, Reason, VerdictDecision } from "../schema.ts";

/** One verdict as the model proposes it. `book` is the ID of a source of the exploration. */
export const ProposedVerdict = z.object({
  book: z.string().min(1).max(64).describe("ID del libro, come nell'elenco delle fonti"),
  decision: VerdictDecision.describe(
    "all = leggere tutto; parts = leggere alcuni capitoli; skip = non leggere; undecided = da decidere",
  ),
  chapters: z
    .array(z.int().min(1))
    .optional()
    .describe("Capitoli da leggere: solo con decision parts, almeno uno"),
  reason: Reason.describe("Motivazione in una riga"),
});
export type ProposedVerdict = z.output<typeof ProposedVerdict>;

export const ProposeVerdictsInput = z.object({
  verdicts: z
    .array(ProposedVerdict)
    .min(1, "Proponi almeno un verdetto")
    .max(MAX_SOURCES, `Al massimo ${MAX_SOURCES} verdetti`)
    .describe("Un verdetto per libro"),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SUMMARY_LENGTH)
    .optional()
    .describe("Sintesi proposta dell'esplorazione (facoltativa)"),
  journal: z
    .string()
    .trim()
    .min(1)
    .max(MAX_JOURNAL_LENGTH)
    .optional()
    .describe("Voce di diario proposta: cosa è emerso e cosa resta da vedere (facoltativa)"),
});
export type ProposeVerdictsInput = z.output<typeof ProposeVerdictsInput>;

/** What the tool answers when the proposal is valid: the model must not claim that anything was saved. */
export const PROPOSAL_ACCEPTED_MESSAGE =
  "Proposta mostrata all'utente: si salva solo dopo la sua conferma.";

/** A source of the exploration, as the validation needs it. */
export type ProposalSource = { id: string; title: string };

/**
 * The problems of a proposal, in Italian, empty when it is valid: unknown books (with the valid IDs), a book
 * proposed twice, `parts` without chapters, and chapters given with another decision.
 */
export function checkVerdictProposal(input: ProposeVerdictsInput, sources: ProposalSource[]): string[] {
  const problems: string[] = [];
  const known = new Map(sources.map((source) => [source.id, source]));
  const valid = sources.map((source) => `${source.id} («${source.title}»)`).join(", ");
  const seen = new Set<string>();

  for (const verdict of input.verdicts) {
    const label = `il libro ${verdict.book}`;
    if (!known.has(verdict.book)) {
      problems.push(
        sources.length === 0
          ? `${label} non è una fonte di questa esplorazione, che non ha fonti.`
          : `${label} non è una fonte di questa esplorazione. Le fonti sono: ${valid}.`,
      );
      continue;
    }
    if (seen.has(verdict.book)) {
      problems.push(`${label} compare più di una volta nella proposta.`);
    }
    seen.add(verdict.book);

    if (verdict.decision === "parts" && (verdict.chapters?.length ?? 0) === 0) {
      problems.push(`per ${label} il verdetto «parts» richiede almeno un capitolo in «chapters».`);
    }
    if (verdict.decision !== "parts" && verdict.chapters !== undefined) {
      problems.push(`per ${label} i capitoli si indicano solo con il verdetto «parts».`);
    }
  }
  return problems;
}
