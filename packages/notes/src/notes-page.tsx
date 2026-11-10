import {
  BookOpenIcon,
  ChevronDownIcon,
  HeadphonesIcon,
  MessageSquareTextIcon,
  PinIcon,
  SearchXIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  type ActiveFilterChip,
  ActiveFilters,
  ClearFiltersButton,
  Container,
  FacetList,
  FacetOption,
  FacetSection,
  FacetStack,
  PageHeader,
  SearchField,
  SearchToolbar,
  ShowMoreButton,
  SidePanelLayout,
  cn,
} from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { SheetClose } from "@ehub/ui/components/sheet";
import { MODULE_ICONS, NoteCard } from "./note-card";
import { type NotesStore, notesStore, useNotes, useNotesMeta } from "./store";
import { NotesErrorBanner } from "./status";
import { matchesTokens, notesCount, searchTokens } from "./text";
import { MODULE_LABELS, type Note, type NoteItemRef, type NoteModule, itemKey } from "./types";

const MODULES: readonly NoteModule[] = ["library", "podcasts"];
const SORTS = {
  recent: "Più recenti",
  oldest: "Meno recenti",
  item: "Per libro o episodio",
} as const;
type Sort = keyof typeof SORTS;
const ITEM_PREVIEW = 8;

interface NotesQuery {
  q: string;
  sources: NoteModule[];
  pinned: boolean;
  item: string | null;
  sort: Sort;
}

function parseQuery(params: URLSearchParams): NotesQuery {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    sources: params
      .getAll("source")
      .filter((s): s is NoteModule => s === "library" || s === "podcasts"),
    pinned: params.get("pinned") === "1",
    item: params.get("item"),
    sort: sort === "oldest" || sort === "item" ? sort : "recent",
  };
}

function toParams(query: NotesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.trim() !== "") params.set("q", query.q);
  for (const source of query.sources) params.append("source", source);
  if (query.pinned) params.set("pinned", "1");
  if (query.item) params.set("item", query.item);
  if (query.sort !== "recent") params.set("sort", query.sort);
  return params;
}

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · e-hub`;
  }, [title]);
}

/** All personal notes across books and podcasts: search, filter by source/item, pinned first. */
export function NotesPage({ store = notesStore }: { store?: NotesStore }) {
  useDocumentTitle("Note");
  const all = useNotes(store);
  const meta = useNotesMeta(store);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseQuery(params), [params]);
  const update = (patch: Partial<NotesQuery>) =>
    setParams(toParams({ ...query, ...patch }), { replace: true });
  const tokens = useMemo(() => searchTokens(query.q), [query.q]);

  // Search first: facet counts reflect the text query, so a filter never leads to an empty list.
  const searched = useMemo(
    () => all.filter((n) => matchesTokens(tokens, n.body, n.item.title, n.item.subtitle)),
    [all, tokens],
  );
  const inSource = (n: Note) => query.sources.length === 0 || query.sources.includes(n.item.module);
  const inItem = (n: Note) => query.item === null || itemKey(n.item) === query.item;
  const isPinned = (n: Note) => !query.pinned || n.pinned;

  const visible = searched
    .filter((n) => inSource(n) && inItem(n) && isPinned(n))
    .sort((a, b) =>
      query.sort === "oldest"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );

  const sourceCounts = countBy(
    searched.filter((n) => inItem(n) && isPinned(n)),
    (n) => n.item.module,
  );
  const pinnedCount = searched.filter((n) => inSource(n) && inItem(n) && n.pinned).length;
  const items = itemFacets(
    searched.filter((n) => inSource(n) && isPinned(n)),
    all,
    query.item,
  );

  // Pinned strip on top of the plain timeline (not when the list is already "only pinned" or grouped).
  const pinnedOnTop = !query.pinned && query.sort !== "item" ? visible.filter((n) => n.pinned) : [];
  const rest = visible.filter((n) => !pinnedOnTop.includes(n));
  const activeCount = query.sources.length + (query.pinned ? 1 : 0) + (query.item ? 1 : 0);
  const filtered = activeCount > 0 || tokens.length > 0;
  const itemTitle = query.item
    ? (items.find((i) => i.key === query.item)?.item.title ?? "Elemento")
    : null;

  const chips: ActiveFilterChip[] = [
    ...(tokens.length > 0
      ? [{ key: "q", label: `“${query.q.trim()}”`, onRemove: () => update({ q: "" }) }]
      : []),
    ...query.sources.map((source) => ({
      key: `source:${source}`,
      label: MODULE_LABELS[source],
      onRemove: () => update({ sources: query.sources.filter((s) => s !== source) }),
    })),
    ...(query.pinned
      ? [{ key: "pinned", label: "Fissate", onRemove: () => update({ pinned: false }) }]
      : []),
    ...(itemTitle
      ? [{ key: "item", label: itemTitle, onRemove: () => update({ item: null }) }]
      : []),
  ];
  const clearAll = () => update({ q: "", sources: [], pinned: false, item: null });

  const renderHeader = (stacked: boolean) => (
    <PageHeader
      stacked={stacked}
          compact
          title="Le mie note"
          description={
            all.length === 0
              ? "Le note che scrivi su libri ed episodi, tutte in un posto."
              : `${notesCount(all.length)} su ${plural(new Set(all.map((n) => itemKey(n.item))).size, "elemento", "elementi")}, ${plural(all.filter((n) => n.pinned).length, "fissata", "fissate")}.`
          }
    />
  );
  const usesPanel = meta.status !== "loading" && all.length > 0;

  return (
    <Container className="pb-16">
      {usesPanel ? null : <div className="pt-6 pb-3 sm:pt-8">{renderHeader(false)}</div>}
      <NotesErrorBanner store={store} className="mb-6" />

      {meta.status === "loading" ? (
        <div className="flex max-w-3xl flex-col gap-3" aria-label="Caricamento delle note">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : all.length === 0 ? (
        meta.status === "error" ? null : (
          <EmptyNotes readOnly={meta.readOnly} />
        )
      ) : (
        <SidePanelLayout
          header={renderHeader}
          description="Filtra le note per fonte, stato e libro o episodio."
          headerAction={
            <ClearFiltersButton
              disabled={activeCount === 0}
              onClick={() => update({ sources: [], pinned: false, item: null })}
            />
          }
          panel={
            <NotesFilterPanel
              query={query}
              update={update}
              sourceCounts={sourceCounts}
              pinnedCount={pinnedCount}
              items={items}
            />
          }
          mobileFooter={
            <SheetClose asChild>
              <Button className="w-full">Mostra {notesCount(visible.length)}</Button>
            </SheetClose>
          }
        >
          <SearchToolbar
            activeFilterCount={activeCount}
            search={
              <SearchField
                value={query.q}
                onChange={(q) => update({ q })}
                label="Cerca nelle note"
                placeholder="Cerca nel testo, nei titoli, negli autori…"
              />
            }
          />

          <ActiveFilters
            summary={
              filtered ? `${notesCount(visible.length)} su ${all.length}` : notesCount(all.length)
            }
            chips={chips}
            onClear={clearAll}
            actions={<SortSelect value={query.sort} onChange={(sort) => update({ sort })} />}
          />

          <div className="max-w-3xl">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center">
                <SearchXIcon aria-hidden className="size-8 text-muted-foreground" />
                <div>
                  <p className="font-serif text-xl font-semibold">Nessuna nota trovata</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Prova con meno parole o togli qualche filtro.
                  </p>
                </div>
                <Button variant="outline" onClick={clearAll}>
                  Azzera filtri
                </Button>
              </div>
            ) : (
              <>
                {pinnedOnTop.length > 0 ? (
                  <section aria-labelledby="notes-pinned" className="mb-10">
                    <h2
                      id="notes-pinned"
                      className="eyebrow mb-3 flex items-center gap-1.5 text-brand"
                    >
                      <PinIcon aria-hidden className="size-3 fill-current" />
                      Fissate · {pinnedOnTop.length}
                    </h2>
                    <ol className="flex flex-col gap-3">
                      {pinnedOnTop.map((note) => (
                        <li key={note.id}>
                          <NoteCard
                            note={note}
                            tokens={tokens}
                            showItem
                            readOnly={meta.readOnly}
                            store={store}
                          />
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {query.sort === "item" ? (
                  <GroupedByItem
                    notes={visible}
                    tokens={tokens}
                    readOnly={meta.readOnly}
                    store={store}
                  />
                ) : rest.length === 0 ? null : (
                  <section aria-labelledby="notes-all">
                    {pinnedOnTop.length > 0 ? (
                      <h2 id="notes-all" className="eyebrow mb-3">
                        Tutte le note
                      </h2>
                    ) : (
                      <h2 id="notes-all" className="sr-only">
                        Note
                      </h2>
                    )}
                    <ol className="flex flex-col gap-3">
                      {rest.map((note) => (
                        <li key={note.id}>
                          <NoteCard
                            note={note}
                            tokens={tokens}
                            showItem
                            readOnly={meta.readOnly}
                            store={store}
                          />
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
          </div>
        </SidePanelLayout>
      )}
    </Container>
  );
}

function GroupedByItem({
  notes,
  tokens,
  readOnly,
  store,
}: {
  notes: readonly Note[];
  tokens: readonly string[];
  readOnly: boolean;
  store: NotesStore;
}) {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = itemKey(note.item);
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  return (
    <div className="flex flex-col gap-10">
      {[...groups.entries()].map(([key, group]) => {
        const item = group[0]!.item;
        const Icon = MODULE_ICONS[item.module];
        // Inside a group: pinned first, then oldest first (the thread order).
        const ordered = [...group].sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
        );
        return (
          <section key={key} aria-label={item.title}>
            <Link
              to={item.href}
              className="mb-3 flex min-w-0 items-center gap-3 rounded-md outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <span
                data-module={item.module}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-serif text-xl font-semibold">
                  {item.title}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {item.subtitle ? `${item.subtitle} · ` : ""}
                  {notesCount(group.length)}
                </span>
              </span>
            </Link>
            <ol className="flex flex-col gap-3 border-l-2 border-border pl-4 sm:pl-5">
              {ordered.map((note) => (
                <li key={note.id}>
                  <NoteCard note={note} tokens={tokens} readOnly={readOnly} store={store} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

interface ItemFacet {
  key: string;
  item: NoteItemRef;
  count: number;
}

function itemFacets(
  scope: readonly Note[],
  all: readonly Note[],
  selected: string | null,
): ItemFacet[] {
  const facets = new Map<string, ItemFacet>();
  for (const note of all) {
    const key = itemKey(note.item);
    if (!facets.has(key)) facets.set(key, { key, item: note.item, count: 0 });
  }
  for (const note of scope) facets.get(itemKey(note.item))!.count += 1;
  return [...facets.values()]
    .filter((f) => f.count > 0 || f.key === selected)
    .sort((a, b) => b.count - a.count || a.item.title.localeCompare(b.item.title, "it"));
}

function NotesFilterPanel({
  query,
  update,
  sourceCounts,
  pinnedCount,
  items,
}: {
  query: NotesQuery;
  update: (patch: Partial<NotesQuery>) => void;
  sourceCounts: ReadonlyMap<string, number>;
  pinnedCount: number;
  items: readonly ItemFacet[];
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.filter((f, i) => i < ITEM_PREVIEW || f.key === query.item);
  return (
    <FacetStack>
      <FacetSection title="Mostra">
        <FacetList>
          <FacetOption
            kind="single"
            label="Tutte le note"
            selected={!query.pinned}
            onSelect={() => update({ pinned: false })}
          />
          <FacetOption
            kind="single"
            label="Solo fissate"
            icon={<PinIcon aria-hidden className="size-3.5 text-brand" />}
            count={pinnedCount}
            selected={query.pinned}
            onSelect={() => update({ pinned: !query.pinned })}
          />
        </FacetList>
      </FacetSection>

      <FacetSection title="Fonte">
        <FacetList>
          {MODULES.map((module) => {
            const Icon = module === "library" ? BookOpenIcon : HeadphonesIcon;
            const selected = query.sources.includes(module);
            return (
              <FacetOption
                key={module}
                label={MODULE_LABELS[module]}
                icon={
                  <span data-module={module} className="text-brand">
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                }
                count={sourceCounts.get(module) ?? 0}
                selected={selected}
                onSelect={() =>
                  update({
                    sources: selected
                      ? query.sources.filter((s) => s !== module)
                      : [...query.sources, module],
                  })
                }
              />
            );
          })}
        </FacetList>
      </FacetSection>

      {items.length > 0 ? (
        <FacetSection title="Libro o episodio">
          <FacetList>
            <FacetOption
              kind="single"
              label="Tutti"
              selected={query.item === null}
              onSelect={() => update({ item: null })}
            />
            {shown.map((facet) => (
              <FacetOption
                key={facet.key}
                kind="single"
                label={<span title={facet.item.title}>{facet.item.title}</span>}
                count={facet.count}
                selected={query.item === facet.key}
                onSelect={() => update({ item: query.item === facet.key ? null : facet.key })}
              />
            ))}
          </FacetList>
          {items.length > ITEM_PREVIEW ? (
            <ShowMoreButton
              noun="elementi"
              total={items.length}
              expanded={showAll}
              onToggle={() => setShowAll((v) => !v)}
            />
          ) : null}
        </FacetSection>
      ) : null}
    </FacetStack>
  );
}

function SortSelect({ value, onChange }: { value: Sort; onChange: (sort: Sort) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="notes-sort" className="hidden text-sm text-muted-foreground sm:inline">
        Ordina per
      </label>
      <div className="relative">
        <select
          id="notes-sort"
          value={value}
          onChange={(event) => onChange(event.target.value as Sort)}
          className={cn(
            "h-9 cursor-pointer appearance-none rounded-full border border-input bg-card pr-9 pl-3.5 text-sm shadow-xs outline-none",
            "transition-[border-color,box-shadow] hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
          )}
        >
          {(Object.keys(SORTS) as Sort[]).map((key) => (
            <option key={key} value={key}>
              {SORTS[key]}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}

function EmptyNotes({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="mx-auto mt-6 flex max-w-xl flex-col items-center gap-5 rounded-2xl border border-dashed px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <MessageSquareTextIcon aria-hidden className="size-6" />
      </span>
      <div>
        <p className="font-serif text-2xl font-semibold">Ancora nessuna nota</p>
        <p className="mt-2 text-muted-foreground">
          {readOnly
            ? "Non ci sono ancora note pubblicate su libri o episodi."
            : "Apri un libro o un episodio e scrivi nella sezione «Le mie note». Qui le ritrovi tutte, con la ricerca e le note fissate in alto."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/library">
            <BookOpenIcon aria-hidden /> Libreria
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/podcasts">
            <HeadphonesIcon aria-hidden /> Podcast
          </Link>
        </Button>
      </div>
    </div>
  );
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
