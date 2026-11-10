/**
 * Ingest (DESIGN.md §6), Node only: add an episode from a URL. Entry points
 * for the CLI (`pnpm episode add`) and the local server (phase 7):
 * `previewAdd` and `addEpisode`. See docs/progress/phase-4.md ("API for phase 7").
 */
export {
  addEpisode,
  FeedDecisionRequiredError,
  previewAdd,
  type AddEpisodeOptions,
  type AddPreview,
  type AddResult,
  type EpisodeDraft,
  type ExistingEpisodeRef,
  type IngestDeps,
  type IngestSource,
  type ShowPreview,
  type TranscriptOutcome,
  type TranscriptPreview,
} from "./add";
export { HttpError, type FetchLike } from "./http";
export type { GitRunner } from "./git";
export type { FeedCandidate } from "./itunes";
export { recognizeUrl, type RecognizedUrl } from "./recognize";
