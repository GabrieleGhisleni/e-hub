import { type ReactNode, useEffect, useState } from "react";
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

/**
 * Hosted build: covers live behind the API (`/api/...`), which wants the session token that an `<img>` cannot send
 * (and the page origin is not the API origin). Those are fetched with the wrapped `fetch` and shown as blob URLs,
 * cached for the page's lifetime; any other URL is used as is.
 */
const blobCovers = new Map<string, Promise<string>>();

function useCoverSrc(url: string | null): string | null | undefined {
  // The API builds absolute cover URLs; `fetch` wants the path (it adds the API origin and the token).
  const apiPath = url === null ? null : /\/api\/library\/site\/covers\/[^/?#]+/.exec(url)?.[0] ?? null;
  const viaApi = apiPath !== null;
  const [blob, setBlob] = useState<{ url: string; src: string | null } | null>(null);
  useEffect(() => {
    if (apiPath === null || url === null) return;
    let current = true;
    let pending = blobCovers.get(url);
    if (!pending) {
      pending = fetch(apiPath).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return URL.createObjectURL(await response.blob());
      });
      blobCovers.set(url, pending);
      pending.catch(() => blobCovers.delete(url));
    }
    pending.then(
      (src) => current && setBlob({ url, src }),
      () => current && setBlob({ url, src: null }),
    );
    return () => {
      current = false;
    };
  }, [url, apiPath]);
  if (!viaApi) return url;
  return blob?.url === url ? blob.src : undefined; // undefined: still loading
}

/** 2:3 cover with a CSS typographic placeholder when there is no image (or it fails to load). */
export function BookCover({ book, alt = "", eager = false, className, children }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = useCoverSrc(book.coverUrl);
  const showImage = book.coverUrl !== null && !failed && src !== null;
  return (
    <div className={cn("book-cover", className)}>
      {showImage ? (
        <img
          src={src ?? undefined}
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
