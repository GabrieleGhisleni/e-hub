import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { isBookId } from "@shared/ids";
import type { BookCard, BookDetail } from "@shared/schema";
import { BookAdminActionsSlot } from "@library/admin-slots";
import { BookCover } from "@library/components/book-cover";
import {
  BookHighlightsSection,
  HIGHLIGHTS_SECTION_ID,
  HIGHLIGHTS_SECTION_TITLE,
} from "@library/components/book/book-highlights-section";
import {
  BookChaptersSection,
  BookSummarySection,
  CHAPTERS_SECTION_ID,
  CHAPTERS_SECTION_TITLE,
  SUMMARY_SECTION_ID,
  SUMMARY_SECTION_TITLE,
  summarizedChapters,
} from "@library/components/book/book-summary-section";
import { CollapsibleBox } from "@library/components/book/collapsible-box";
import { isFromLibraryState } from "@library/components/library/book-card";
import { Container, PageHeader, SourceExtras } from "@ehub/ui";
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
    <div className="border-t border-border/80 py-2.5 first:border-t-0 first:pt-0">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{term}</dt>
      <dd className="mt-0.5 text-[0.9375rem] break-words">{children}</dd>
    </div>
  );
}

/** Metadata list next to the cover (only the fields the book has). */
function BookDetails({ book }: { book: BookDetail }) {
  return (
    <dl>
      <Detail term={book.authors.length > 1 ? "Autori" : "Autore"}>
        {book.authors.join(", ")}
      </Detail>
      {book.translators && book.translators.length > 0 ? (
        <Detail term={book.translators.length > 1 ? "Traduttori" : "Traduttore"}>
          {book.translators.join(", ")}
        </Detail>
      ) : null}
      {book.year ? (
        <Detail term="Anno">
          <span className="tabular-nums">{book.year}</span>
        </Detail>
      ) : null}
      {book.pages ? (
        <Detail term="Pagine">
          <span className="tabular-nums">{book.pages}</span>
        </Detail>
      ) : null}
      {book.startedAt ? <Detail term="Iniziato">{formatDate(book.startedAt)}</Detail> : null}
      {book.finishedAt ? <Detail term="Finito">{formatDate(book.finishedAt)}</Detail> : null}
      {book.publisher ? <Detail term="Editore">{book.publisher}</Detail> : null}
      {book.language ? <Detail term="Lingua">{formatLanguage(book.language)}</Detail> : null}
      {book.isbn ? (
        <Detail term="ISBN">
          <span className="tabular-nums">{book.isbn}</span>
        </Detail>
      ) : null}
      {book.subjects && book.subjects.length > 0 ? (
        <Detail term="Soggetti">
          <ul className="flex flex-wrap gap-1.5">
            {book.subjects.map((subject) => (
              <li key={subject} className="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                {subject}
              </li>
            ))}
          </ul>
        </Detail>
      ) : null}
    </dl>
  );
}

/** The publisher's description: the main text when there is no summary, folded under it otherwise. */
function Description({ text, folded }: { text: string; folded: boolean }) {
  const body = (
    <div className="prose-book">
      {paragraphs(text).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
  if (!folded) {
    return (
      <section aria-labelledby="descrizione">
        <h2
          id="descrizione"
          className="flex items-center gap-4 text-2xl font-medium tracking-tight sm:text-3xl"
        >
          Descrizione
          <span aria-hidden className="h-px flex-1 bg-border" />
        </h2>
        <div className="mt-5">{body}</div>
      </section>
    );
  }
  return (
    <details className="group mt-8 rounded-xl border border-border/80 px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> Descrizione
        dell&apos;editore
      </summary>
      <div className="mt-3 [&_.prose-book]:text-base">{body}</div>
    </details>
  );
}

interface NoteSection {
  id: string;
  title: string;
  html: string;
}

/** The general notes ("Appunti", block right under the cover and summary, `notes.md`). */
const NOTES_SECTION_ID = "appunti";

/** The study sessions ("Studio", `study.md`), after the chapters and highlights. */
function studySection(book: BookDetail): NoteSection | null {
  return book.studyHtml ? { id: "studio", title: "Studio", html: book.studyHtml } : null;
}

/** "Appunti": the general notes of the book, a full-width box like Capitoli and Sottolineature (open by default). */
function NotesBlock({ html }: { html: string | null }) {
  return (
    <CollapsibleBox id={NOTES_SECTION_ID} title="Appunti">
      {html ? (
        <div
          className="prose-book mt-5 max-w-none"
          // Sanitized at build time (raw HTML in the Markdown is escaped).
          dangerouslySetInnerHTML={{ __html: demoteHeadings(html) }}
        />
      ) : (
        <p className="mt-5 rounded-xl border border-dashed px-5 py-6 text-sm text-muted-foreground">
          Ancora nessun appunto. Apri «Chatta» e chiedi di scriverli dalle tue sottolineature.
        </p>
      )}
    </CollapsibleBox>
  );
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
  const study = full ? studySection(full) : null;
  const summaryAction = __ELIB_ADMIN__ && full ? (
    <BookAdminActionsSlot book={full} index={index.data} placement="summary" />
  ) : null;
  const highlights = full?.highlights ?? [];
  const hasChapters = full?.summary ? summarizedChapters(full.summary).length > 0 : false;
  // In-page navigation, in page order: summary, notes, chapters, highlights, study.
  const navSections: { id: string; title: string }[] = [
    ...(full?.summary ? [{ id: SUMMARY_SECTION_ID, title: SUMMARY_SECTION_TITLE }] : []),
    ...(full?.notesHtml || (full && __ELIB_ADMIN__) ? [{ id: NOTES_SECTION_ID, title: "Appunti" }] : []),
    ...(hasChapters ? [{ id: CHAPTERS_SECTION_ID, title: CHAPTERS_SECTION_TITLE }] : []),
    ...(highlights.length > 0 ? [{ id: HIGHLIGHTS_SECTION_ID, title: HIGHLIGHTS_SECTION_TITLE }] : []),
    ...(study ? [{ id: study.id, title: study.title }] : []),
  ];
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
            <div className="mt-8" aria-busy>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-12 w-3/5" />
              <Skeleton className="mt-4 h-6 w-1/3" />
              <div className="mt-10 grid gap-10 lg:grid-cols-2">
                <div className="grid grid-cols-2 gap-6">
                  <Skeleton className="aspect-[2/3] w-full" />
                  <DetailSkeleton />
                </div>
                <DetailSkeleton />
              </div>
            </div>
          )
        ) : (
          <>
            <PageHeader
              className="mt-4 pt-0 pb-0 sm:pt-0"
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
                  <BookAdminActionsSlot book={full} index={index.data} placement="toolbar" />
                ) : undefined
              }
            />

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {noteItem ? <NotesJumpLink item={noteItem} /> : null}
              <StatusBadge status={book.status} />
              <SourceExtras kind="book" id={book.id} />
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

            {/* Top: cover and metadata beside the summary. */}
            <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-14">
              <div className="lg:sticky lg:top-8 lg:self-start">
                {/* Same heading as "Sintesi" (next column), so the two columns start on the same line. */}
                <h2 className="flex items-center gap-4 text-2xl font-medium tracking-tight sm:text-3xl">
                  Scheda
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </h2>
                <div className="mt-5 grid items-start gap-6 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div className="mx-auto w-full max-w-60 sm:mx-0 sm:max-w-96">
                    {__ELIB_ADMIN__ && full ? (
                      <BookAdminActionsSlot book={full} index={index.data} placement="cover" />
                    ) : (
                      <BookCover book={book} alt={`Copertina di ${book.title}`} eager className="w-full" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {full ? (
                      <BookDetails book={full} />
                    ) : detail.state.status === "error" ? null : (
                      <DetailSkeleton />
                    )}
                  </div>
                </div>
              </div>

              <div className="min-w-0">
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
                    {full.summary ? (
                      <BookSummarySection summary={full.summary} action={summaryAction} />
                    ) : summaryAction ? (
                      <div className={full.description ? "mb-5" : undefined}>{summaryAction}</div>
                    ) : null}
                    {full.description ? (
                      <Description text={full.description} folded={Boolean(full.summary)} />
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {full ? (
              <>
                {navSections.length > 1 ? (
                  <nav
                    aria-label="In questa pagina"
                    className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
                  >
                    <span className="text-muted-foreground">In questa pagina:</span>
                    {navSections.map((s) => (
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

                <div className="mt-6 flex flex-col gap-6">
                  {full.notesHtml || __ELIB_ADMIN__ ? <NotesBlock html={full.notesHtml} /> : null}
                  {full.summary ? <BookChaptersSection summary={full.summary} /> : null}
                  <BookHighlightsSection highlights={highlights} />
                </div>

                {study ? (
                  <section aria-labelledby={study.id} className="mt-14">
                    <h2
                      id={study.id}
                      tabIndex={-1}
                      className="flex scroll-mt-6 items-center gap-4 text-3xl font-medium tracking-tight outline-none sm:text-[2.125rem]"
                    >
                      {study.title}
                      <span aria-hidden className="h-px flex-1 bg-border" />
                    </h2>
                    <div
                      className="prose-book mt-6"
                      // Sanitized at build time (raw HTML in the Markdown is escaped).
                      dangerouslySetInnerHTML={{ __html: demoteHeadings(study.html) }}
                    />
                  </section>
                ) : null}
              </>
            ) : null}

            {noteItem ? (
              <NoteThread
                item={noteItem}
                noun="questo libro"
                className="mt-14 border-t border-border pt-10"
              />
            ) : null}
          </>
        )}
      </article>
    </Container>
  );
}
