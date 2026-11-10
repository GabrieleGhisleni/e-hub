import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { isBookId } from "@shared/ids";
import type { BookCard, BookDetail } from "@shared/schema";
import { BookAdminActionsSlot } from "@library/admin-slots";
import { BookCover } from "@library/components/book-cover";
import { isFromLibraryState } from "@library/components/library/book-card";
import { Container, PageHeader } from "@ehub/ui";
import { type NoteItemRef, NoteThread, NotesJumpLink } from "@ehub/notes";
import { ErrorState } from "@library/components/states";
import { StatusBadge } from "@library/components/status-badge";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { findCard, topicLabel, useBookDetail, useSiteIndex } from "@library/data/site-data";
import { useDocumentTitle } from "@library/hooks/use-document-title";
import {
  bookHref,
  formatAuthors,
  formatDate,
  formatLanguage,
  paragraphs,
} from "@library/lib/format";
import { demoteHeadings } from "@library/lib/html";
import { EMPTY_QUERY, libraryQueryString } from "@library/lib/library-query";
import { NotFoundPage } from "./not-found-page";
import { libraryPath } from "@library/lib/paths";

function BackLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = isFromLibraryState(location.state) ? location.state : null;
  return (
    <Link
      to={libraryPath(from?.search ?? "")}
      onClick={(event) => {
        // Came from the grid: a real "back" restores filters *and* scroll position.
        if (
          !from ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(-1);
      }}
      className="group -ml-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-brand"
    >
      <ArrowLeftIcon
        aria-hidden
        className="size-4 transition-transform group-hover:-translate-x-0.5"
      />
      {from && from.search !== "" ? "Torna ai risultati" : "Torna alla biblioteca"}
    </Link>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 border-t border-border/80 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-[0.9375rem] break-words">{children}</dd>
    </div>
  );
}

interface NoteSection {
  id: string;
  title: string;
  html: string;
  compact?: boolean;
}

function noteSections(book: BookDetail): NoteSection[] {
  const sections: (NoteSection | null)[] = [
    book.recallHtml
      ? { id: "da-ricordare", title: "Da ricordare", html: book.recallHtml, compact: true }
      : null,
    book.notesHtml ? { id: "appunti", title: "Appunti", html: book.notesHtml } : null,
    book.studyHtml ? { id: "studio", title: "Studio", html: book.studyHtml } : null,
  ];
  return sections.filter((s): s is NoteSection => s !== null);
}

function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
}

function DetailSkeleton() {
  return (
    <div className="mt-8 flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-7 w-32 rounded-full" />
      <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-4 w-2/3 max-w-md" />
    </div>
  );
}

export function BookPage() {
  const params = useParams();
  const location = useLocation();
  const rawId = params.id ?? "";
  const id = rawId.toLowerCase();
  const valid = isBookId(id);
  const index = useSiteIndex();
  const detail = useBookDetail(valid ? id : null);
  const card = findCard(index.data, id);
  const book: BookCard | undefined = detail.data ?? card;
  const notFound = !valid || detail.state.status === "not-found";
  useDocumentTitle(
    book ? `${book.title} — ${formatAuthors(book.authors)}` : notFound ? "Libro non trovato" : null,
  );

  if (notFound) return <NotFoundPage kind="book" />;

  // Canonical URL: lowercase ID + current slug (old or missing slugs redirect, keeping the history state).
  if (book && (rawId !== id || params.slug !== book.slug)) {
    return (
      <Navigate
        replace
        to={{ pathname: libraryPath(bookHref(book)), search: location.search, hash: location.hash }}
        state={location.state}
      />
    );
  }

  const full = detail.data;
  const topic = book && index.data ? topicLabel(index.data, book.topic) : null;
  const sections = full ? noteSections(full) : [];
  const noteItem: NoteItemRef | null = book
    ? {
        module: "library",
        id: book.id,
        title: book.title,
        subtitle: formatAuthors(book.authors),
        href: libraryPath(bookHref(book)),
      }
    : null;

  return (
    <Container className="pt-6 pb-16 sm:pt-8">
      <article>
        <BackLink />

        {!book ? (
          detail.state.status === "error" ? (
            <ErrorState
              title="Impossibile caricare il libro"
              error={detail.state.error}
              onRetry={detail.retry}
            />
          ) : (
            <div
              className="mt-8 grid gap-10 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-16"
              aria-busy
            >
              <Skeleton className="mx-auto aspect-[2/3] w-full max-w-[15rem] md:max-w-none" />
              <div>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-4 h-12 w-4/5" />
                <Skeleton className="mt-4 h-6 w-1/2" />
                <DetailSkeleton />
              </div>
            </div>
          )
        ) : (
          <div className="mt-6 grid gap-9 sm:mt-8 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-12 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-16">
            <div>
              <div className="md:sticky md:top-8">
                <BookCover
                  book={book}
                  alt={`Copertina di ${book.title}`}
                  eager
                  className="mx-auto w-[min(56vw,14rem)] md:w-full"
                />
              </div>
            </div>

            <div className="min-w-0">
              <PageHeader
                className="pt-0 pb-0 sm:pt-0"
                eyebrow={
                  topic ? (
                    <Link
                      to={libraryPath(libraryQueryString({ ...EMPTY_QUERY, topic: book.topic }))}
                      className="font-sans text-xs font-semibold tracking-[0.16em] text-brand uppercase underline-offset-4 hover:underline"
                    >
                      {topic}
                    </Link>
                  ) : undefined
                }
                title={book.title}
                description={
                  <span className="font-serif text-xl text-foreground/80 italic sm:text-2xl">
                    {formatAuthors(book.authors)}
                  </span>
                }
                actions={
                  __ELIB_ADMIN__ && full ? (
                    <BookAdminActionsSlot book={full} index={index.data} />
                  ) : undefined
                }
              />

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {noteItem ? <NotesJumpLink item={noteItem} /> : null}
                <StatusBadge status={book.status} />
                {book.tags.map((tag) => (
                  <Link
                    key={tag}
                    to={libraryPath(libraryQueryString({ ...EMPTY_QUERY, tags: [tag] }))}
                    className="inline-flex h-7 items-center rounded-full px-2.5 text-sm text-muted-foreground transition-colors hover:bg-brand-soft hover:text-brand"
                  >
                    <span aria-hidden className="mr-0.5 text-brand/70">
                      #
                    </span>
                    {tag}
                  </Link>
                ))}
              </div>

              {!full ? (
                detail.state.status === "error" ? (
                  <ErrorState
                    title="Impossibile caricare i dettagli"
                    error={detail.state.error}
                    onRetry={detail.retry}
                    className="items-start py-10 text-left"
                  />
                ) : (
                  <DetailSkeleton />
                )
              ) : (
                <>
                  {full.description ? (
                    <div className="prose-book mt-8">
                      {paragraphs(full.description).map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  ) : null}

                  <dl className="mt-9 max-w-[42rem] border-b border-border/80">
                    {full.startedAt ? (
                      <Detail term="Iniziato">{formatDate(full.startedAt)}</Detail>
                    ) : null}
                    {full.finishedAt ? (
                      <Detail term="Finito">{formatDate(full.finishedAt)}</Detail>
                    ) : null}
                    {full.publisher ? <Detail term="Editore">{full.publisher}</Detail> : null}
                    {full.language ? (
                      <Detail term="Lingua">{formatLanguage(full.language)}</Detail>
                    ) : null}
                    {full.isbn ? (
                      <Detail term="ISBN">
                        <span className="tabular-nums">{full.isbn}</span>
                      </Detail>
                    ) : null}
                    {full.subjects && full.subjects.length > 0 ? (
                      <Detail term="Soggetti">
                        <ul className="flex flex-wrap gap-1.5">
                          {full.subjects.map((subject) => (
                            <li
                              key={subject}
                              className="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground"
                            >
                              {subject}
                            </li>
                          ))}
                        </ul>
                      </Detail>
                    ) : null}
                  </dl>

                  {sections.length > 1 ? (
                    <nav
                      aria-label="In questa pagina"
                      className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
                    >
                      <span className="text-muted-foreground">In questa pagina:</span>
                      {sections.map((s) => (
                        <a
                          key={s.id}
                          href={`#${s.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            scrollToSection(s.id);
                          }}
                          className="font-medium text-brand underline-offset-4 hover:underline"
                        >
                          {s.title}
                        </a>
                      ))}
                    </nav>
                  ) : null}

                  {sections.map((section) =>
                    section.compact ? (
                      <section
                        key={section.id}
                        aria-labelledby={section.id}
                        className="mt-10 max-w-[44rem] rounded-xl border border-brand/20 bg-brand-soft/70 px-5 py-6 sm:px-8 sm:py-7"
                      >
                        <h2
                          id={section.id}
                          tabIndex={-1}
                          className="scroll-mt-6 font-sans text-xs font-semibold tracking-[0.16em] text-brand uppercase outline-none"
                        >
                          {section.title}
                        </h2>
                        <div
                          className="prose-book prose-book--compact mt-4"
                          // Sanitized at build time (raw HTML in the Markdown is escaped).
                          dangerouslySetInnerHTML={{ __html: demoteHeadings(section.html) }}
                        />
                      </section>
                    ) : (
                      <section key={section.id} aria-labelledby={section.id} className="mt-14">
                        <h2
                          id={section.id}
                          tabIndex={-1}
                          className="flex scroll-mt-6 items-center gap-4 text-3xl font-medium tracking-tight outline-none sm:text-[2.125rem]"
                        >
                          {section.title}
                          <span aria-hidden className="h-px flex-1 bg-border" />
                        </h2>
                        <div
                          className="prose-book mt-6"
                          // Sanitized at build time (raw HTML in the Markdown is escaped).
                          dangerouslySetInnerHTML={{ __html: demoteHeadings(section.html) }}
                        />
                      </section>
                    ),
                  )}
                </>
              )}

              {noteItem ? (
                <NoteThread
                  item={noteItem}
                  noun="questo libro"
                  className="mt-14 max-w-[44rem] border-t border-border pt-10"
                />
              ) : null}
            </div>
          </div>
        )}
      </article>
    </Container>
  );
}
