/**
 * Status of the chapter summaries of an exploration's sources, for the web UI (`GET /api/explore/:id/summaries`).
 * Explore books report the in-process progress of their run; library books only say whether a summary exists.
 */
import type { BookSource } from "../schema.ts";
import type { LibraryDeps } from "./library.ts";

export type SummaryState = "none" | "running" | "done" | "failed";

export type BookSummaryStatus = {
  bookId: string;
  origin: "library" | "explore";
  state: SummaryState;
  done?: number;
  total?: number;
  error?: string;
};

/** Where the background summaries report their progress and failures. */
export type SummaryLogger = { info(message: string): void; warn(message: string): void };

export async function summaryStatuses(
  sources: readonly BookSource[],
  deps: LibraryDeps,
): Promise<BookSummaryStatus[]> {
  return Promise.all(
    sources.map(async (source): Promise<BookSummaryStatus> => {
      if (source.origin === "explore") {
        const status = await deps.exploreSummaryStatus(source.id);
        return { bookId: source.id, origin: "explore", ...status };
      }
      const done = (await deps.readLibraryBookSummary(source.id)) !== null;
      return { bookId: source.id, origin: "library", state: done ? "done" : "none" };
    }),
  );
}
