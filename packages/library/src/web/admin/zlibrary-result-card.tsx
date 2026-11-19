/**
 * One Z-Library result: cover, metadata and the two actions ("Biblioteca" stages the file for the upload form,
 * "Esplorazione" adds the EPUB to an exploration). Only EPUB results can be used.
 */
import { ArrowRightIcon, BookOpenIcon, CheckIcon, LibraryIcon, Loader2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ZLIBRARY_LANGUAGES, type ZlibraryBook } from "@shared/zlibrary";
import { Button } from "@ehub/ui/components/button";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { cn } from "@library/lib/utils";
import type { ExplorationSummary } from "./explore-client";
import { ExploreMenu, type ExplorationsState } from "./zlibrary-explore-menu";

export type BusyKind = "stage" | "explore";

export function isEpubResult(book: ZlibraryBook): boolean {
  return book.extension.toUpperCase() === "EPUB";
}

function languageLabel(code: string): string {
  return ZLIBRARY_LANGUAGES.find((l) => l.value === code.toLowerCase())?.label ?? code;
}

/** The API's description is HTML: keep the text only. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function Cover({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  const box = "aspect-[2/3] w-24 shrink-0 rounded-md shadow-md ring-1 ring-black/5";
  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={cn(
          box,
          "flex items-center justify-center bg-brand-soft p-2 text-center font-serif text-lg font-medium text-brand",
        )}
      >
        {initials(title) || <BookOpenIcon className="size-5" />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(box, "bg-muted object-cover")}
    />
  );
}

function Badge({ children, accent = false }: { children: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium tabular-nums",
        accent ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** The exploration this book was last added to, shown as a success line inside the card. */
export interface AddedExploration {
  id: string;
  title: string;
}

export function ZlibraryResultCard({
  book,
  busy,
  added,
  explorations,
  onStage,
  onLoadExplorations,
  onPickExploration,
  onNewExploration,
  onOpenExploration,
  action,
}: {
  book: ZlibraryBook;
  busy: BusyKind | undefined;
  added: AddedExploration | undefined;
  explorations: ExplorationsState;
  onStage: () => void;
  onLoadExplorations: () => void;
  onPickExploration: (exploration: ExplorationSummary) => void;
  onNewExploration: () => void;
  onOpenExploration: (id: string) => void;
  action?: ReactNode;
}) {
  const epub = isEpubResult(book);
  const anyBusy = busy !== undefined;
  const description = book.description ? plainText(book.description) : "";
  const badges = [
    book.year !== null ? String(book.year) : null,
    book.language ? languageLabel(book.language) : null,
    book.sizeLabel,
    book.pages !== null ? `${book.pages} p.` : null,
  ].filter((part): part is string => part !== null && part !== "");

  return (
    <li className="flex gap-4 rounded-2xl border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm">
      <Cover src={book.cover} title={book.title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="font-serif text-base leading-snug font-medium text-pretty text-foreground line-clamp-2">
          {book.title}
        </h3>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {book.author || "Autore sconosciuto"}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge accent>{book.extension.toUpperCase()}</Badge>
          {badges.map((badge) => (
            <Badge key={badge}>{badge}</Badge>
          ))}
        </div>

        {description ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {description}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {action ?? (
            <>
              <Button
                size="sm"
                disabled={!epub || anyBusy}
                onClick={onStage}
                title="Aggiungi alla biblioteca: verrà convertito in KEPUB e caricato sul Kobo"
              >
                {busy === "stage" ? <Loader2Icon className="animate-spin" /> : <LibraryIcon />}
                Biblioteca
              </Button>
              <ExploreMenu
                disabled={!epub || anyBusy}
                busy={busy === "explore"}
                state={explorations}
                onOpen={onLoadExplorations}
                onPick={onPickExploration}
                onNew={onNewExploration}
              />
            </>
          )}
          {!epub ? <span className="text-xs text-muted-foreground">Solo EPUB</span> : null}
        </div>

        {added ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <CheckIcon aria-hidden className="size-3.5 shrink-0 text-brand" />
            <span className="min-w-0 truncate">Aggiunto a «{added.title}»</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1 p-0 text-xs"
              onClick={() => onOpenExploration(added.id)}
            >
              Apri
              <ArrowRightIcon aria-hidden className="size-3" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Placeholder card with the same shape, shown while a search is loading. */
export function ZlibraryResultSkeleton() {
  return (
    <li className="flex gap-4 rounded-2xl border border-border bg-card p-3" aria-hidden>
      <Skeleton className="aspect-[2/3] w-24 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-1 h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-auto h-8 w-40" />
      </div>
    </li>
  );
}
