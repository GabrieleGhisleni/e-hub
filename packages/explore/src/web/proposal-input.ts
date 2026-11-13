/*
 * Reads the input of the `propose_verdicts` tool call for the proposal card. Uses the shared schema and checks from
 * `chat/proposal.ts` (the same rules the chat applies). The card is dev-only, so the schema lives in its chunk.
 * Nothing here writes anything.
 */
import {
  type ProposeVerdictsInput,
  ProposeVerdictsInput as ProposalSchema,
  checkVerdictProposal,
  type ProposalSource,
} from "../chat/proposal.ts";

export const PROPOSAL_TOOL = "propose_verdicts";

export type ParsedProposal =
  | { ok: true; value: ProposeVerdictsInput }
  | { ok: false; message: string };

/** Validates the tool input against the schema and the exploration's sources; `message` is for the user. */
export function readProposal(input: unknown, sources: ProposalSource[]): ParsedProposal {
  const result = ProposalSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    return { ok: false, message: `${where}${first?.message ?? "formato non valido"}.` };
  }
  const problems = checkVerdictProposal(result.data, sources);
  if (problems.length > 0) return { ok: false, message: problems.join(" ") };
  return { ok: true, value: result.data };
}

/** Chapters typed in a text field: "2, 5" or "2 5" → [2, 5]; undefined when any part is not a chapter number. */
export function parseChapterText(text: string): number[] | undefined {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== "");
  if (parts.length === 0) return undefined;
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1)) return undefined;
  return [...new Set(numbers)].sort((a, b) => a - b);
}
