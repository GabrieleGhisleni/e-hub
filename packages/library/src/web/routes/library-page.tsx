import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookGrid, BookGridSkeleton } from "@library/components/library/book-grid";
import { FilterPanel } from "@library/components/library/filter-panel";
import {
  type ActiveFilterChip,
  ActiveFilters,
  ClearFiltersButton,
  Container,
  PageHeader,
  SearchField,
  SearchToolbar,
  SidePanelLayout,
} from "@ehub/ui";
import { SheetClose } from "@ehub/ui/components/sheet";
import { STATUS_LABELS } from "@shared/labels";
import type { SiteIndex } from "@shared/schema";
import { ErrorState, MessageState } from "@library/components/states";
import { Button } from "@ehub/ui/components/button";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { LibraryAdminBarSlot } from "@library/admin-slots";
import { topicLabel, useSiteIndex } from "@library/data/site-data";
import { useDocumentTitle } from "@library/hooks/use-document-title";
import { useLibraryQuery } from "@library/hooks/use-library-query";
import { booksCount, resultCountLabel } from "@library/lib/format";
import {
  type LibraryQuery,
  activeFilterCount,
  applyLibraryQuery,
  clearFilters,
  computeFacets,
  hasActiveFilters,
  libraryQueryString,
  tagKey,
  toggleTag,
  toggleValue,
} from "@library/lib/library-query";

/** Debounce of the search box → URL (typing stays instant: the grid filters on the local text). */
const SEARCH_URL_DELAY = 250;

export function LibraryPage() {
  const { state, data: index, retry } = useSiteIndex();
  const [urlQuery, setUrlQuery] = useLibraryQuery();
  const searchRef = useRef<HTMLInputElement>(null);

  // Local search text: the input never waits for the router. `sent` is the last q written to the URL,
  // so URL changes we did not make (back button, links) flow back into the input.
  const [text, setText] = useState(urlQuery.q);
  const sent = useRef(urlQuery.q.trim());
  useEffect(() => {
    if (urlQuery.q.trim() !== sent.current) {
      sent.current = urlQuery.q.trim();
      setText(urlQuery.q);
    }
  }, [urlQuery.q]);

  const query = useMemo<LibraryQuery>(() => ({ ...urlQuery, q: text }), [urlQuery, text]);

  const commit = useCallback(
    (next: LibraryQuery, replace = false) => {
      sent.current = next.q.trim();
      setText(next.q);
      setUrlQuery(next, { replace });
    },
    [setUrlQuery],
  );

  // Search text → URL, debounced. The first keystroke of a search pushes a history entry, the rest replace it.
  useEffect(() => {
    if (text.trim() === urlQuery.q.trim()) return;
    const timer = setTimeout(() => {
      sent.current = text.trim();
      setUrlQuery({ ...urlQuery, q: text }, { replace: urlQuery.q.trim() !== "" });
    }, SEARCH_URL_DELAY);
    return () => clearTimeout(timer);
  }, [text, urlQuery, setUrlQuery]);

  const deferredQuery = useDeferredValue(query);
  const books = index?.books;
  const visible = useMemo(
    () => (books ? applyLibraryQuery(books, deferredQuery) : []),
    [books, deferredQuery],
  );
  const facets = useMemo(
    () => (books ? computeFacets(books, deferredQuery) : null),
    [books, deferredQuery],
  );
  // Masthead numbers: the whole library, or the selected topic.
  const stats = useMemo(() => {
    const scope = (books ?? []).filter((b) => query.topic === null || b.topic === query.topic);
    return {
      total: scope.length,
      reading: scope.filter((b) => b.status === "reading").length,
      read: scope.filter((b) => b.status === "read").length,
    };
  }, [books, query.topic]);

  const heading = query.topic ? topicLabel(index, query.topic) : "Biblioteca";
  useDocumentTitle(query.topic ? heading : null);
  const librarySearch = libraryQueryString({ ...urlQuery, q: text });
  const filtered = hasActiveFilters(query);
  const activeCount = activeFilterCount(query);

  return (
    <Container className="pb-16">
      <SidePanelLayout
        header={(stacked) => (
          <PageHeader
            stacked={stacked}
            compact
            title={heading}
            description={
              index ? (
                <>
                  {booksCount(stats.total)}
                  {stats.reading > 0 ? <> · {stats.reading} in lettura</> : null}
                  {stats.read > 0 ? (
                    <>
                      {" "}
                      · {stats.read} {stats.read === 1 ? "letto" : "letti"}
                    </>
                  ) : null}
                </>
              ) : state.status === "error" ? (
                " "
              ) : (
                <span
                  aria-hidden
                  className="inline-block h-4 w-48 animate-pulse rounded-md bg-muted align-middle"
                />
              )
            }
          />
        )}
        description="Filtra la biblioteca per argomento, stato e tag."
        headerAction={
          <ClearFiltersButton
            disabled={activeCount === 0}
            onClick={() => commit(clearFilters(query))}
          />
        }
        panel={
          index && facets ? (
            <FilterPanel index={index} query={query} facets={facets} onChange={commit} />
          ) : (
            <div className="flex flex-col gap-3" aria-hidden>
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-4/5" />
              ))}
            </div>
          )
        }
        mobileFooter={<SheetCloseButton>Mostra {booksCount(visible.length)}</SheetCloseButton>}
      >
        <SearchToolbar
          activeFilterCount={activeCount}
          search={
            <SearchField
              value={text}
              onChange={setText}
              inputRef={searchRef}
              label="Cerca per titolo o autore"
              placeholder="Cerca titolo o autore"
            />
          }
        />

        <ActiveFilters
          summary={index ? resultCountLabel(visible.length, index.books.length) : " "}
          chips={index ? activeChips(index, query, commit) : []}
          onClear={() => commit(clearFilters(query))}
        />

        {__ELIB_ADMIN__ && index ? (
          <div className="mb-8">
            <LibraryAdminBarSlot index={index} visibleBooks={visible} />
          </div>
        ) : null}

        {state.status === "error" ? (
          <ErrorState
            title="Impossibile caricare la biblioteca"
            error={state.error}
            onRetry={retry}
          />
        ) : !index ? (
          <BookGridSkeleton />
        ) : index.books.length === 0 ? (
          <MessageState title="La biblioteca è ancora vuota">
            <p>Quando ci saranno dei libri, compariranno qui.</p>
          </MessageState>
        ) : visible.length === 0 ? (
          <MessageState
            title="Nessun libro trovato"
            action={
              filtered ? (
                <Button variant="outline" onClick={() => commit(clearFilters(query))}>
                  Azzera filtri
                </Button>
              ) : null
            }
          >
            <p>Nessun libro corrisponde alla ricerca e ai filtri scelti.</p>
          </MessageState>
        ) : (
          <BookGrid books={visible} librarySearch={librarySearch} />
        )}
      </SidePanelLayout>
    </Container>
  );
}

function SheetCloseButton({ children }: { children: ReactNode }) {
  return (
    <SheetClose asChild>
      <Button className="w-full">{children}</Button>
    </SheetClose>
  );
}

/** One removable pill per active filter (search text, topic, statuses, tags). */
function activeChips(
  index: SiteIndex,
  query: LibraryQuery,
  onChange: (next: LibraryQuery) => void,
): ActiveFilterChip[] {
  const q = query.q.trim();
  return [
    ...(q !== ""
      ? [{ key: "q", label: `“${q}”`, onRemove: () => onChange({ ...query, q: "" }) }]
      : []),
    ...(query.topic !== null
      ? [
          {
            key: "topic",
            label: topicLabel(index, query.topic),
            onRemove: () => onChange({ ...query, topic: null }),
          },
        ]
      : []),
    ...query.statuses.map((status) => ({
      key: `status:${status}`,
      label: STATUS_LABELS[status],
      onRemove: () => onChange({ ...query, statuses: toggleValue(query.statuses, status) }),
    })),
    ...query.tags.map((tag) => ({
      key: `tag:${tagKey(tag)}`,
      label: `#${tag}`,
      onRemove: () => onChange({ ...query, tags: toggleTag(query.tags, tag) }),
    })),
  ];
}
