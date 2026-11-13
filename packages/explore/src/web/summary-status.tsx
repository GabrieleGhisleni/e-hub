import { CheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@ehub/ui/components/button";
import { type BookSummaryStatus, type ExploreStore, exploreStore } from "./store.ts";

/** How often the status is read again while a summary runs. */
export const SUMMARY_POLL_MS = 2000;

/**
 * Chapter-summary status of an exploration's sources. Reads the status while any book runs (every `SUMMARY_POLL_MS`),
 * then stops; `retry` restarts a failed explore book and reads the status again. Disabled (`enabled: false`) it
 * never fetches: the page passes its `devTools` flag, so the published site makes no requests.
 */
export function useSummaryStatus(
  explorationId: string,
  { enabled = true, store = exploreStore }: { enabled?: boolean; store?: ExploreStore } = {},
): { statuses: ReadonlyMap<string, BookSummaryStatus>; retry: (bookId: string) => Promise<void> } {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, BookSummaryStatus>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const active = enabled && explorationId !== "";

  useEffect(() => {
    if (!active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      let books: BookSummaryStatus[] | undefined;
      try {
        books = (await store.summaries(explorationId)).books;
      } catch {
        // Keep the last status; a failed read does not start a poll loop by itself.
        return;
      }
      if (!current) return;
      setStatuses(new Map(books.map((book) => [book.bookId, book])));
      if (books.some((book) => book.state === "running")) {
        timer = setTimeout(() => void read(), SUMMARY_POLL_MS);
      }
    };
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, explorationId, store, refresh]);

  const retry = useCallback(
    async (bookId: string) => {
      await store.retrySummary(explorationId, bookId);
      setRefresh((n) => n + 1);
    },
    [store, explorationId],
  );

  return { statuses: active ? statuses : new Map(), retry };
}

/** The summary line under a source: progress while running, the result when done, the error with a retry. */
export function SummaryLine({
  status,
  onRetry,
}: {
  status: BookSummaryStatus | undefined;
  onRetry?: (bookId: string) => Promise<void>;
}) {
  const [retryError, setRetryError] = useState<string | null>(null);
  if (!status || status.state === "none") return null;

  if (status.state === "running") {
    const known = status.total !== undefined && status.total > 0;
    const done = status.done ?? 0;
    return (
      <div className="mt-2 flex max-w-sm flex-col gap-1.5">
        <div
          role="progressbar"
          aria-label="Avanzamento della sintesi"
          aria-valuemin={0}
          aria-valuemax={known ? status.total : undefined}
          aria-valuenow={known ? done : undefined}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {known ? (
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.round((done / status.total!) * 100))}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/60" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {known ? `Sintesi in corso · ${done}/${status.total} capitoli` : "Sintesi in corso…"}
        </p>
      </div>
    );
  }

  if (status.state === "done") {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CheckIcon aria-hidden className="size-3.5" />
        Sintesi pronta
      </p>
    );
  }

  // failed
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-xs text-destructive">
        <span title={status.error}>Sintesi non riuscita</span>
        {onRetry ? (
          <>
            {" · "}
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0 text-xs text-destructive"
              onClick={() => {
                setRetryError(null);
                onRetry(status.bookId).catch((error: unknown) =>
                  setRetryError(`Riprova non riuscita: ${(error as Error).message}`),
                );
              }}
            >
              Riprova
            </Button>
          </>
        ) : null}
      </p>
      {retryError ? (
        <p role="alert" className="text-xs text-destructive">
          {retryError}
        </p>
      ) : null}
    </div>
  );
}
