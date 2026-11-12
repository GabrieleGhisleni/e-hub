/**
 * Book summaries (docs/chat.md §4): the service behind `POST /api/library/books/:id/summary` and `elib summarize`.
 * Maps the summarizer's errors to the API codes of `ApiErrorCode`.
 */
import {
  type SummarizeRequest,
  SummarizeRequestSchema,
  type SummarizeResponse,
} from "../../shared/api.ts";
import { AiConfigError } from "@ehub/chat/node";
import { EpubNotFoundError, EpubTextError } from "../text/index.ts";
import {
  AiFailedError,
  type SummarizeProgress,
  TextUnavailableError,
  summarizeBook,
} from "../summary/index.ts";
import type { ServiceContext } from "./context.ts";
import { ServiceError, conflict } from "./errors.ts";
import { loadBook, parseInput } from "./internal.ts";

export const AI_NOT_CONFIGURED_MESSAGE = "Chat AI non configurata: copia .env.example in .env.local";

export interface SummarizeServiceOptions {
  onProgress?: (event: SummarizeProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

/**
 * Regenerates `summary.json` of a book (the text too with `force`). One run per book at a time in this process:
 * a second request for the same book gets 409 `busy`.
 */
export async function summarizeBookService(
  ctx: ServiceContext,
  id: string,
  request: SummarizeRequest,
  options: SummarizeServiceOptions = {},
): Promise<SummarizeResponse> {
  const req = parseInput(SummarizeRequestSchema, request, "sintesi");
  await loadBook(ctx, id);
  if (ctx.summariesInProgress.has(id)) {
    throw conflict("busy", `La sintesi del libro ${id} è già in corso: attendi che finisca.`);
  }

  let model: ReturnType<ServiceContext["summaryModel"]>;
  try {
    model = ctx.summaryModel();
  } catch (error) {
    if (error instanceof AiConfigError) {
      throw new ServiceError("ai-not-configured", 503, AI_NOT_CONFIGURED_MESSAGE, { cause: error });
    }
    throw error;
  }

  ctx.summariesInProgress.add(id);
  try {
    return await summarizeBook(
      {
        dataDir: ctx.dataDir,
        drive: ctx.drive,
        model: model.model,
        configuredModel: model.configuredModel,
        ...(model.reasoningEffort !== undefined ? { reasoningEffort: model.reasoningEffort } : {}),
        now: ctx.now,
      },
      id,
      {
        language: req.language,
        force: req.force,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.concurrency ? { concurrency: options.concurrency } : {}),
      },
    );
  } catch (error) {
    if (error instanceof AiFailedError) {
      throw new ServiceError("ai-failed", 502, error.message, { cause: error });
    }
    if (error instanceof TextUnavailableError || error instanceof EpubNotFoundError || error instanceof EpubTextError) {
      throw new ServiceError("text-unavailable", 422, error.message, { cause: error });
    }
    throw error;
  } finally {
    ctx.summariesInProgress.delete(id);
  }
}
