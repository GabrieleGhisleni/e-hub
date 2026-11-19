import { BookOpenIcon, CheckSquareIcon, CompassIcon } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ActiveFilters,
  ClearFiltersButton,
  Container,
  FacetChip,
  FacetChips,
  FacetSection,
  FacetStack,
  PageHeader,
  SearchField,
  SearchToolbar,
  SidePanelLayout,
  type ActiveFilterChip,
} from "@ehub/ui";
import { SheetClose } from "@ehub/ui/components/sheet";
import { Badge } from "@ehub/ui/components/badge";
import { Button } from "@ehub/ui/components/button";
import type { SourceCover } from "./integrations.ts";
import { formatVerdict } from "../labels.ts";
import type { Exploration } from "../schema.ts";
import { DevExplorationNewLink, DevKoboButton, DevKoboSelectBox } from "./dev-slots.tsx";
import { STATUS_LABELS, explorationHref, formatDay } from "./format.ts";
import { ExploreErrorBanner, MessageState } from "./status.tsx";
import { type ExploreStore, exploreStore, useExploreMeta, useExplorations } from "./store.ts";

/** Sources shown per card before the rest is folded into "e altri N". */
const SOURCES_PREVIEW = 4;

function ExplorationCard({
  exploration,
  selection,
  cover: Cover,
  privateCover,
}: {
  exploration: Exploration;
  cover?: SourceCover;
  privateCover: boolean;
  /** Local dev: a checkbox to pick explorations for the Kobo. */
  selection?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const shown = exploration.sources.slice(0, SOURCES_PREVIEW);
  const first = shown[0];
  const summary = exploration.summary ?? exploration.synthesis?.body;
  const hidden = exploration.sources.length - shown.length;
  return (
    <li className="relative">
      {selection && DevKoboSelectBox ? (
        <div className="absolute top-4 right-4 z-10 sm:top-5 sm:right-5">
          <Suspense fallback={null}>
            <DevKoboSelectBox
              checked={selection.checked}
              onChange={selection.onChange}
              title={exploration.title}
            />
          </Suspense>
        </div>
      ) : null}
      <Link
        to={explorationHref(exploration.id)}
        className="book-link group grid h-full grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <div className="flex items-start border-r border-border/70 bg-linear-to-br from-brand-soft via-muted to-card p-3 sm:p-5">
          <div className="w-24 sm:w-32 xl:w-40">
            {first && Cover ? (
              <Cover source={first} explorationId={exploration.id} privateCover={privateCover} />
            ) : (
              <div className="flex aspect-[2/3] items-center justify-center rounded-md border border-border bg-card/70 text-muted-foreground" aria-hidden>
                <BookOpenIcon className="size-8" />
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 p-3 sm:p-6">
          <div className={`flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm ${selection ? "pr-7" : ""}`}>
            <Badge variant={exploration.status === "open" ? "secondary" : "outline"}>
              {STATUS_LABELS[exploration.status]}
            </Badge>
            <time dateTime={exploration.createdAt}>{formatDay(exploration.createdAt)}</time>
          </div>
          {exploration.tags && exploration.tags.length > 0 ? (
            <ul aria-label="Tag" className="mt-3 flex flex-wrap gap-1.5">
              {exploration.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="outline">{tag}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <h2 className="mt-3 font-serif text-xl leading-tight font-medium tracking-tight group-hover:text-brand sm:text-2xl">
            {exploration.title}
          </h2>
          <p className="mt-2 text-[0.9375rem] text-foreground/80 italic">{exploration.question}</p>

          {exploration.sources.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {shown.map((source) => (
                <li key={source.id} className="flex min-w-0 flex-wrap gap-x-2">
                  <span className="min-w-0 font-medium break-words">{source.title}</span>
                  <span className="text-muted-foreground">· {formatVerdict(source.verdict)}</span>
                </li>
              ))}
              {hidden > 0 ? <li className="text-muted-foreground">e altri {hidden}</li> : null}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Nessuna fonte ancora.</p>
          )}

          {summary ? (
            <p className="mt-4 line-clamp-3 text-sm text-foreground/75">{summary}</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/** All explorations, newest first. Read-only on the published site. */
export function ExplorationListPage({
  store = exploreStore,
  devTools = import.meta.env.DEV,
  cover,
}: {
  store?: ExploreStore;
  cover?: SourceCover;
  /** Show the local-only actions (default: only in the dev server). */
  devTools?: boolean;
}) {
  const all = useExplorations(store);
  const meta = useExploreMeta(store);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Exploration["status"] | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const tags = useMemo(
    () => [...new Set(all.flatMap((e) => e.tags ?? []))].sort((a, b) => a.localeCompare(b, "it")),
    [all],
  );
  const normalize = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/\p{M}/gu, "");
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const visible = all.filter((exploration) => {
    if (tagFilter && !exploration.tags?.includes(tagFilter)) return false;
    if (status && exploration.status !== status) return false;
    const searchable = normalize([
      exploration.title,
      exploration.question,
      ...(exploration.tags ?? []),
      ...exploration.sources.flatMap((source) => [source.title, ...source.authors]),
    ].join(" "));
    return terms.every((term) => searchable.includes(term));
  });
  const clear = () => {
    setQuery("");
    setStatus(null);
    setTagFilter(null);
  };
  const chips: ActiveFilterChip[] = [];
  if (query.trim()) chips.push({ key: "query", label: query.trim(), onRemove: () => setQuery("") });
  if (status) chips.push({ key: "status", label: STATUS_LABELS[status], onRemove: () => setStatus(null) });
  if (tagFilter) chips.push({ key: "tag", label: tagFilter, onRemove: () => setTagFilter(null) });
  const kobo = devTools && DevKoboButton !== null && !meta.readOnly;
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  useEffect(() => {
    document.title = "Esplorazioni · e-hub";
  }, []);

  return (
    <Container className="pb-16">
      <SidePanelLayout
        header={() => (
          <PageHeader title="Esplorazioni" description="Domande poste ai libri." />
        )}
        description="Filtra le esplorazioni per stato o tag."
        headerAction={<ClearFiltersButton disabled={chips.length === 0} onClick={clear} />}
        panel={
          <FacetStack>
            <FacetSection title="Stato">
              <FacetChips label="Stato">
                {(["open", "closed"] as const).map((value) => (
                  <FacetChip
                    key={value}
                    label={STATUS_LABELS[value]}
                    selected={status === value}
                    onSelect={() => setStatus(status === value ? null : value)}
                  />
                ))}
              </FacetChips>
            </FacetSection>
            {tags.length > 0 ? (
              <FacetSection title="Tag">
                <FacetChips label="Tag">
                  {tags.map((tag) => (
                    <FacetChip
                      key={tag}
                      label={tag}
                      selected={tagFilter === tag}
                      onSelect={() => setTagFilter(tagFilter === tag ? null : tag)}
                    />
                  ))}
                </FacetChips>
              </FacetSection>
            ) : null}
          </FacetStack>
        }
        mobileFooter={<SheetClose asChild><Button>Mostra risultati</Button></SheetClose>}
      >
        <SearchToolbar
          activeFilterCount={chips.length}
          search={
            <SearchField
              value={query}
              onChange={setQuery}
              label="Cerca nelle esplorazioni"
              placeholder="Cerca titolo, domanda, libro o autore"
            />
          }
        />
        <ExploreErrorBanner store={store} className="mt-4" />
        <ActiveFilters
          summary={`${visible.length} ${visible.length === 1 ? "esplorazione" : "esplorazioni"}`}
          chips={chips}
          onClear={clear}
          actions={
            devTools ? (
              <>
                {kobo && DevKoboButton ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={visible.length === 0}
                      onClick={() => setSelected((current) => {
                        const next = new Set(current);
                        for (const exploration of visible) {
                          if (allVisibleSelected) next.delete(exploration.id);
                          else next.add(exploration.id);
                        }
                        return next;
                      })}
                    >
                      <CheckSquareIcon aria-hidden />
                      {allVisibleSelected ? "Deseleziona le visibili" : "Seleziona le visibili"}
                    </Button>
                    <Suspense fallback={null}>
                      <DevKoboButton
                        ids={[...selected]}
                        store={store}
                        label={selected.size > 0 ? `Aggiungi alla libreria (${selected.size})` : "Aggiungi alla libreria"}
                      />
                    </Suspense>
                  </>
                ) : null}
                {DevExplorationNewLink ? (
                  <Suspense fallback={null}><DevExplorationNewLink /></Suspense>
                ) : null}
              </>
            ) : undefined
          }
        />

        {meta.status === "loading" && all.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground" aria-busy>Caricamento…</p>
        ) : all.length === 0 ? (
          <MessageState icon={<CompassIcon aria-hidden />} title="Nessuna esplorazione ancora">
            <p>Un’esplorazione raccoglie una domanda, i libri su cui cercare la risposta e i verdetti.</p>
          </MessageState>
        ) : visible.length === 0 ? (
          <MessageState icon={<CompassIcon aria-hidden />} title="Nessuna esplorazione trovata">
            <p>Prova a modificare la ricerca o i filtri.</p>
          </MessageState>
        ) : (
          <ul className="grid max-w-5xl gap-4">
            {visible.map((exploration) => (
              <ExplorationCard
                key={exploration.id}
                exploration={exploration}
                cover={cover}
                privateCover={!meta.readOnly && devTools}
                selection={kobo ? {
                  checked: selected.has(exploration.id),
                  onChange: (on) => toggle(exploration.id, on),
                } : undefined}
              />
            ))}
          </ul>
        )}
      </SidePanelLayout>
    </Container>
  );
}
