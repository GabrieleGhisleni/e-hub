import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router";
import { AudioLines, SearchX } from "lucide-react";
import type { Episode } from "@core/schema";
import { countTags } from "@core/tags";
import { EpisodeRow } from "@podcasts/components/episode-row";
import { FilterPanel, type FacetValue } from "@podcasts/components/filter-panel";
import { StateMessage } from "@podcasts/components/states";
import { useDocumentTitle } from "@podcasts/components/site-layout";
import {
  type ActiveFilterChip,
  ActiveFilters,
  ClearFiltersButton,
  PageHeader,
  SearchField,
  SearchToolbar,
  SidePanelLayout,
} from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { SheetClose } from "@ehub/ui/components/sheet";
import { DevSlot } from "@podcasts/dev-slot";
import { groupByAddedMonth } from "@podcasts/lib/catalog";
import {
  EMPTY_FILTERS,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
  toggleValue,
  type Filters,
} from "@podcasts/lib/filters";
import { formatMonth, monthKey, plural } from "@podcasts/lib/format";
import { showImageUrl } from "@podcasts/lib/images";
import { filterEpisodes } from "@podcasts/lib/search";
import { useSiteData } from "@podcasts/site-data";

export function HomePage() {
  useDocumentTitle();
  const { catalog, index } = useSiteData();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const result = useMemo(() => filterEpisodes(catalog, index, filters), [catalog, index, filters]);

  const update = (next: Partial<Filters>) =>
    setSearchParams(filtersToParams({ ...filters, ...next }), { replace: true });
  const toggleTag = (tag: string) => update({ tags: toggleValue(filters.tags, tag) });
  const toggleShow = (show: string) => update({ shows: toggleValue(filters.shows, show) });
  const clearAll = () => update(EMPTY_FILTERS);

  const showOptions = useMemo<FacetValue[]>(() => {
    const used = new Set(catalog.episodes.map((episode) => episode.show));
    return catalog.shows
      .filter((show) => used.has(show.slug) || filters.shows.includes(show.slug))
      .map((show) => ({
        value: show.slug,
        label: show.name,
        count: result.showCounts.get(show.slug) ?? 0,
        imageUrl: showImageUrl(show),
      }));
  }, [catalog, filters.shows, result.showCounts]);

  // Global popularity order, so items don't jump around while filtering.
  const tagOptions = useMemo<FacetValue[]>(
    () =>
      countTags(catalog.episodes).map(({ tag }) => ({
        value: tag,
        label: tag,
        count: result.tagCounts.get(tag) ?? 0,
      })),
    [catalog.episodes, result.tagCounts],
  );

  const total = catalog.episodes.length;
  const usedShows = new Set(catalog.episodes.map((episode) => episode.show)).size;
  const filtered = hasActiveFilters(filters);
  const groups = result.searched ? undefined : groupByAddedMonth(result.episodes, monthKey);

  const showName = (slug: string) => catalog.showsBySlug.get(slug)?.name ?? slug;
  const activeCount = filters.shows.length + filters.tags.length;
  const chips: ActiveFilterChip[] = [
    ...(filters.q.trim() !== ""
      ? [{ key: "q", label: `“${filters.q.trim()}”`, onRemove: () => update({ q: "" }) }]
      : []),
    ...filters.shows.map((slug) => ({
      key: `show:${slug}`,
      label: showName(slug),
      onRemove: () => toggleShow(slug),
    })),
    ...filters.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: `#${tag}`,
      onRemove: () => toggleTag(tag),
    })),
  ];

  const renderHeader = (stacked: boolean) => (
    <PageHeader
      stacked={stacked}
      compact
      title="Podcast ascoltati"
      description={
        total === 0
          ? "Il catalogo è ancora vuoto."
          : `${plural(total, "episodio", "episodi")} da ${plural(usedShows, "show", "show")}, con sintesi, appunti e conversazioni.`
      }
      actions={<DevSlot name="header-actions" />}
    />
  );

  return (
    <div>
      {total === 0 ? <div className="pt-6 pb-3 sm:pt-8">{renderHeader(false)}</div> : null}

      {total === 0 ? (
        <EmptyCatalog />
      ) : (
        <SidePanelLayout
          header={renderHeader}
          description="Filtra gli episodi per show e tag."
          headerAction={
            <ClearFiltersButton
              disabled={activeCount === 0}
              onClick={() => update({ shows: [], tags: [] })}
            />
          }
          panel={
            <FilterPanel
              shows={showOptions}
              tags={tagOptions}
              selectedShows={filters.shows}
              selectedTags={filters.tags}
              onToggleShow={toggleShow}
              onToggleTag={toggleTag}
            />
          }
          mobileFooter={
            <SheetClose asChild>
              <Button className="w-full">
                Mostra {plural(result.episodes.length, "episodio", "episodi")}
              </Button>
            </SheetClose>
          }
        >
          <SearchToolbar
            activeFilterCount={activeCount}
            search={
              <SearchField
                value={filters.q}
                onChange={(q) => update({ q })}
                label="Cerca negli episodi"
                placeholder="Cerca per titolo, ospite, tag, appunti…"
              />
            }
            actions={
              <DevSlot name="home-toolbar" episodes={catalog.episodes} shows={catalog.shows} />
            }
          />

          <ActiveFilters
            summary={
              filtered
                ? `${plural(result.episodes.length, "episodio", "episodi")} su ${total}`
                : plural(total, "episodio", "episodi")
            }
            chips={chips}
            onClear={clearAll}
          />

          <div className="max-w-4xl">
            {result.episodes.length === 0 ? (
              <NoResults query={filters.q.trim()} onClear={clearAll} />
            ) : groups ? (
              <div className="space-y-8 sm:space-y-12">
                {groups.map((group) => (
                  <section key={group.key} aria-labelledby={`month-${group.key}`}>
                    <h2
                      id={`month-${group.key}`}
                      className="eyebrow flex items-baseline gap-2 px-3 pb-2 sm:px-4"
                    >
                      {formatMonth(group.episodes[0]?.addedAt ?? "")}
                      <span className="font-normal tracking-normal normal-case">
                        · {plural(group.episodes.length, "episodio", "episodi")}
                      </span>
                    </h2>
                    <EpisodeList
                      episodes={group.episodes}
                      filters={filters}
                      onToggleTag={toggleTag}
                      listSearch={location.search}
                    />
                  </section>
                ))}
              </div>
            ) : (
              <section aria-label="Risultati della ricerca">
                <EpisodeList
                  episodes={result.episodes}
                  filters={filters}
                  onToggleTag={toggleTag}
                  listSearch={location.search}
                />
              </section>
            )}
            {filtered && result.episodes.length > 0 && (
              <p className="mt-8 text-center text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded underline underline-offset-4 transition-colors outline-none hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  Mostra tutti gli episodi
                </button>
              </p>
            )}
          </div>
        </SidePanelLayout>
      )}
    </div>
  );
}

function EpisodeList({
  episodes,
  filters,
  onToggleTag,
  listSearch,
}: {
  episodes: readonly Episode[];
  filters: Filters;
  onToggleTag: (tag: string) => void;
  listSearch: string;
}) {
  const { catalog } = useSiteData();
  return (
    <ul className="-mx-3 divide-y divide-border/60 sm:-mx-4">
      {episodes.map((episode) => (
        <li key={episode.slug} className="py-1">
          <EpisodeRow
            episode={episode}
            show={catalog.showsBySlug.get(episode.show)}
            activeTags={filters.tags}
            onToggleTag={onToggleTag}
            listSearch={listSearch}
          />
        </li>
      ))}
    </ul>
  );
}

function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <StateMessage
      icon={SearchX}
      title="Nessun episodio trovato"
      action={
        <Button variant="outline" onClick={onClear}>
          Azzera filtri
        </Button>
      }
    >
      {query
        ? `Nessun risultato per «${query}» con i filtri scelti. Prova con meno parole o togli qualche filtro.`
        : "Nessun episodio ha tutti i filtri scelti. Prova a toglierne qualcuno."}
    </StateMessage>
  );
}

function EmptyCatalog() {
  const { catalog } = useSiteData();
  if (!import.meta.env.DEV) {
    return (
      <StateMessage icon={AudioLines} title="Ancora nessun episodio">
        Gli episodi ascoltati, con i loro appunti, compariranno qui.
      </StateMessage>
    );
  }
  return (
    <StateMessage icon={AudioLines} title="Aggiungi il primo episodio">
      Incolla l'URL di un episodio di Lex Fridman, di Huberman Lab o di un qualsiasi video YouTube.
      Dalla riga di comando:{" "}
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-foreground">
        pnpm episode add &lt;url&gt;
      </code>
      <div className="mt-6 empty:hidden">
        <DevSlot name="home-empty" shows={catalog.shows} />
      </div>
    </StateMessage>
  );
}
