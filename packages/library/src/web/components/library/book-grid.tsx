import type { BookCard as BookCardData } from "@shared/schema";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { useLibrarySelection } from "@library/selection";
import { BookCard } from "./book-card";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-11 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 2xl:gap-x-8";

/** Eager-load roughly the first row on wide screens. */
const EAGER_COUNT = 6;

export function BookGrid({
  books,
  librarySearch,
}: {
  books: readonly BookCardData[];
  librarySearch: string;
}) {
  const selection = useLibrarySelection();
  return (
    <ul className={GRID} aria-label="Libri">
      {books.map((book, i) => (
        <li key={book.id} className="min-w-0">
          <BookCard
            book={book}
            librarySearch={librarySearch}
            eager={i < EAGER_COUNT}
            selectable={selection.selecting}
            selected={selection.selectedIds.has(book.id)}
            onToggleSelect={selection.toggle}
          />
        </li>
      ))}
    </ul>
  );
}

export function BookGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[2/3] w-full rounded-[2px_4px_4px_2px]" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}
