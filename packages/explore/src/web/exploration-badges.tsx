import { CompassIcon } from "lucide-react";
import { Link } from "react-router";
import { formatVerdict } from "../labels.ts";
import { explorationBadgeText, explorationHref } from "./format.ts";
import { exploreStore, type ExploreStore, explorationsOfBook, useExplorations } from "./store.ts";

/**
 * Shown on a library book's page: every exploration that has this book as a source, with the verdict it has there.
 * Rendered by the app through `SourceExtrasProvider`, so the library never imports this package.
 */
export function ExplorationBadges({
  bookId,
  store = exploreStore,
}: {
  bookId: string;
  store?: ExploreStore;
}) {
  const all = useExplorations(store);
  const found = explorationsOfBook(all, bookId);
  if (found.length === 0) return null;
  return (
    <ul aria-label="Esplorazioni di questo libro" className="flex basis-full flex-col items-start gap-1.5">
      {found.map(({ exploration, source }) => (
        <li key={exploration.id}>
          <Link
            to={explorationHref(exploration.id)}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand/30 bg-brand-soft/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-brand-soft"
          >
            <CompassIcon aria-hidden className="size-4 shrink-0 text-brand" />
            <span className="min-w-0 break-words">
              {explorationBadgeText(exploration.title, formatVerdict(source.verdict))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
