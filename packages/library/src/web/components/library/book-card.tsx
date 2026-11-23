import { CheckIcon } from "lucide-react";
import { Link } from "react-router";
import type { BookCard as BookCardData } from "@shared/schema";
import { NoteCountBadge } from "@ehub/notes";
import { BookCover } from "@library/components/book-cover";
import { prefetchBook } from "@library/data/site-data";
import { bookHref, formatAuthors } from "@library/lib/format";
import { cn } from "@library/lib/utils";
import { libraryPath } from "@library/lib/paths";

/** History state carried from the grid to a book page: lets "back to the library" restore filters and scroll. */
export interface FromLibraryState {
  fromLibrary: true;
  /** Library query string at the time of the click ("" or "?…"). */
  search: string;
}

export function isFromLibraryState(value: unknown): value is FromLibraryState {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as FromLibraryState).fromLibrary === true &&
    typeof (value as FromLibraryState).search === "string"
  );
}

export interface BookCardProps {
  book: BookCardData;
  /** Current library query string, stored in the link state for the way back. */
  librarySearch: string;
  /** Load the cover eagerly (first row). */
  eager?: boolean;
  /** Admin bulk selection (no-op in public mode): the card toggles selection instead of opening the book. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

function CardBody({
  book,
  eager,
  selected,
}: {
  book: BookCardData;
  eager: boolean;
  selected?: boolean;
}) {
  const authors = formatAuthors(book.authors);
  const edition = [
    book.pages !== undefined ? `${book.pages} ${book.pages === 1 ? "pagina" : "pagine"}` : null,
    book.year,
    book.publisher,
  ].filter(Boolean).join(" · ");
  return (
    <>
      <BookCover book={book} eager={eager}>
        {book.status === "read" ? (
          <span className="absolute top-3 left-0 z-10 rounded-r-sm bg-status-read px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-white shadow-sm">
            Letto
          </span>
        ) : null}
        {book.status === "reading" ? (
          <span className="absolute bottom-2 left-2.5 z-10 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide text-foreground shadow-sm backdrop-blur-sm">
            <span aria-hidden className="size-1.5 rounded-full bg-status-reading" />
            In lettura
          </span>
        ) : null}
        {selected === undefined ? (
          <NoteCountBadge
            module="library"
            id={book.id}
            variant="overlay"
            className="absolute top-2 right-2 z-10"
          />
        ) : null}
        {selected !== undefined ? (
          <span
            aria-hidden
            className={cn(
              "absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full border-2 shadow-sm transition-colors",
              selected
                ? "border-brand bg-brand text-background"
                : "border-white/90 bg-black/25 text-transparent",
            )}
          >
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
        ) : null}
      </BookCover>
      <span className="mt-3 block font-serif text-[1.0625rem] leading-snug font-medium text-pretty text-foreground decoration-brand/50 underline-offset-[0.2em] transition-colors group-hover:text-brand group-hover:underline sm:text-lg sm:leading-snug">
        <span className="line-clamp-3">{book.title}</span>
      </span>
      {authors ? (
        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{authors}</span>
      ) : null}
      {edition ? (
        <span className="mt-1 block text-xs text-muted-foreground">{edition}</span>
      ) : null}
    </>
  );
}

export function BookCard({
  book,
  librarySearch,
  eager = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: BookCardProps) {
  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onToggleSelect?.(book.id)}
        className={cn(
          "book-link group block w-full cursor-pointer text-left",
          selected &&
            "[&_.book-cover]:outline-2 [&_.book-cover]:outline-offset-3 [&_.book-cover]:outline-brand",
        )}
      >
        <CardBody book={book} eager={eager} selected={selected} />
      </button>
    );
  }
  const state: FromLibraryState = { fromLibrary: true, search: librarySearch };
  return (
    <Link
      to={libraryPath(bookHref(book))}
      state={state}
      className="book-link group block"
      onPointerEnter={() => prefetchBook(book.id)}
      onFocus={() => prefetchBook(book.id)}
    >
      <CardBody book={book} eager={eager} />
    </Link>
  );
}
