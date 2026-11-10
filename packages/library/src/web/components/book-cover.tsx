import { type ReactNode, useState } from "react";
import type { BookCard } from "@shared/schema";
import { formatAuthors, placeholderTone } from "@library/lib/format";
import { cn } from "@library/lib/utils";

interface BookCoverProps {
  book: Pick<BookCard, "id" | "title" | "authors" | "coverUrl">;
  /**
   * Alt text for the image. Empty (decorative) in the grid, where the link already carries title and author;
   * descriptive on the book page.
   */
  alt?: string;
  /** Load eagerly (above the fold). */
  eager?: boolean;
  className?: string;
  children?: ReactNode;
}

/** 2:3 cover with a CSS typographic placeholder when there is no image (or it fails to load). */
export function BookCover({ book, alt = "", eager = false, className, children }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = book.coverUrl !== null && !failed;
  return (
    <div className={cn("book-cover", className)}>
      {showImage ? (
        <img
          src={book.coverUrl ?? undefined}
          alt={alt}
          width={600}
          height={900}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          // Cached images (back navigation) are complete at mount: show them without the fade-in.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setLoaded(true);
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <div
          className="cover-placeholder"
          data-tone={placeholderTone(book.id)}
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        >
          <span className="cover-placeholder__title">{book.title}</span>
          <span className="cover-placeholder__rule" />
          <span className="cover-placeholder__author">{formatAuthors(book.authors)}</span>
        </div>
      )}
      {children}
    </div>
  );
}
