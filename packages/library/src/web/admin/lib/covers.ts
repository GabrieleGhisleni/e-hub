/** Cover-choice rules (PLAN §8), pure and unit-tested. */
import type { CoverCandidate, CoverSource } from "../../../shared/api.ts";

/**
 * Initial selection: the EPUB cover when there is one (always my edition). An Open Library cover is preselected
 * only when it matched by ISBN and nothing else exists; a title/author match is NEVER preselected (it must be
 * confirmed by hand). Otherwise the generated placeholder.
 */
export function defaultCoverChoice(candidates: readonly CoverCandidate[]): CoverSource {
  if (candidates.some((c) => c.source === "epub")) return "epub";
  const ol = candidates.find((c) => c.source === "openlibrary");
  if (ol && !ol.needsConfirmation) return "openlibrary";
  return "placeholder";
}

/** `openLibraryCoverId` to send with `cover: "openlibrary"` (the server checks it is still the staged one). */
export function openLibraryIdFor(
  choice: CoverSource,
  candidates: readonly CoverCandidate[],
): number | undefined {
  if (choice !== "openlibrary") return undefined;
  return candidates.find((c) => c.source === "openlibrary")?.openLibraryCoverId;
}
