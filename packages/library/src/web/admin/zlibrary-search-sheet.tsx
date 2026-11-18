/**
 * Wide right-side sheet to search the Z-Library catalogue (local admin only). A result can go to the "Aggiungi libro"
 * flow ("Biblioteca") or be added as an EPUB to an exploration ("Esplorazione"). The component stays mounted while the
 * sheet is closed, so the query, the filters and the results survive closing and reopening.
 */
import {
  BookOpenIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ZLIBRARY_EXTENSIONS,
  ZLIBRARY_LANGUAGES,
  ZLIBRARY_ORDERS,
  type ZlibraryBook,
  type ZlibrarySearchRequest,
  type ZlibrarySearchResponse,
  type ZlibraryStatusResponse,
} from "@shared/zlibrary";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ehub/ui/components/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@ehub/ui/components/sheet";
import { Textarea } from "@ehub/ui/components/textarea";
import { libraryPath } from "@library/lib/paths";
import { cn } from "@library/lib/utils";
import { adminApi } from "./api";
import {
  addEpubToExploration,
  createExploration,
  ExploreError,
  listExplorations,
  type ExplorationSummary,
} from "./explore-client";
import { friendlyMessage } from "./lib/errors";
import type { ExplorationsState } from "./zlibrary-explore-menu";
import {
  ZlibraryResultCard,
  ZlibraryResultSkeleton,
  type AddedExploration,
  type BusyKind,
} from "./zlibrary-result-card";

/** Page size of the Z-Library API: a full page with fewer raw results is the last one. */
const PAGE_SIZE = 30;
const EXPANDED_KEY = "elib:zlibrary-search-expanded";

const ALL = "all";

const SIZE_OPTIONS = [
  { value: "any", label: "Qualsiasi" },
  { value: "2", label: "2 MB" },
  { value: "5", label: "5 MB" },
  { value: "10", label: "10 MB" },
  { value: "20", label: "20 MB" },
  { value: "50", label: "50 MB" },
] as const;

type Extension = (typeof ZLIBRARY_EXTENSIONS)[number];

/** The filters as the user edits them (strings, as the controls hold them). */
interface Filters {
  language: string;
  /** An extension, or "all". */
  format: string;
  yearFrom: string;
  yearTo: string;
  /** A size option value, or "any". */
  maxSize: string;
  order: string;
}

const DEFAULT_FILTERS: Filters = {
  language: ALL,
  format: "EPUB",
  yearFrom: "",
  yearTo: "",
  maxSize: "any",
  order: "bestmatch",
};

/** A search as it was submitted: pagination reuses this snapshot, not the form. */
interface ActiveSearch {
  query: string;
  filters: Filters;
  page: number;
}

function parseYear(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const year = Number.parseInt(value, 10);
  return Number.isFinite(year) ? year : undefined;
}

function buildRequest(search: ActiveSearch): ZlibrarySearchRequest {
  const { query, filters, page } = search;
  const maxSizeMb = Number.parseFloat(filters.maxSize);
  return {
    query,
    page,
    languages: filters.language === ALL ? [] : [filters.language],
    extensions: filters.format === ALL ? [] : [filters.format as Extension],
    yearFrom: parseYear(filters.yearFrom),
    yearTo: parseYear(filters.yearTo),
    maxSizeMb: filters.maxSize === "any" ? undefined : maxSizeMb,
    order: filters.order,
  };
}

/** Message of a failed call: Explore's own text, or the library's friendly mapping. */
function errorText(error: unknown): string {
  if (error instanceof ExploreError) return error.message;
  return friendlyMessage(error);
}

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // Storage blocked (private window): the choice just does not persist.
  }
}

function quotaTone(today: number, limit: number): string {
  if (today >= limit) return "bg-destructive/10 text-destructive";
  if (today / limit >= 0.8)
    return "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function ZlibrarySearchSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  // Status (quota / configuration), refreshed each time the sheet opens.
  const [status, setStatus] = useState<ZlibraryStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(readExpanded);

  // Search form (draft) and the submitted search with its results.
  const [draftQuery, setDraftQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSearch | null>(null);
  const [result, setResult] = useState<ZlibrarySearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Per-row busy state, keyed by `id/hash`, so one row's action does not block the others.
  const [busyRows, setBusyRows] = useState<Record<string, BusyKind>>({});

  // Last exploration each book was added to, keyed like `busyRows`, shown inside the card.
  const [addedRows, setAddedRows] = useState<Record<string, AddedExploration>>({});

  // Explorations, loaded the first time an "Esplorazione" menu opens and shared by all rows.
  const [explorations, setExplorations] = useState<ExplorationsState>({
    status: "idle",
    items: [],
    error: null,
  });

  // The book being sent to a new exploration (its dialog is open while set), and the dialog's fields.
  const [createTarget, setCreateTarget] = useState<ZlibraryBook | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [creating, setCreating] = useState(false);

  const searchAbort = useRef<AbortController | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect(email: string, password: string) {
    setConnecting(true);
    setConnectError(null);
    try {
      setStatus(await adminApi.zlibraryConnect(email, password));
      setStatusError(null);
      adminApi
        .zlibraryStatus()
        .then(setStatus)
        .catch(() => {});
    } catch (error) {
      setConnectError(friendlyMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await adminApi.zlibraryDisconnect();
      setStatus((prev) => (prev ? { ...prev, configured: false, account: null, quota: null, error: null } : prev));
      setResult(null);
      setActive(null);
    } catch (error) {
      toast.error(friendlyMessage(error));
    }
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    setStatusLoading(true);
    adminApi
      .zlibraryStatus()
      .then((next) => {
        if (!current) return;
        setStatus(next);
        setStatusError(null);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setStatus(null);
        setStatusError(friendlyMessage(error));
      })
      .finally(() => {
        if (current) setStatusLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open]);

  useEffect(() => () => searchAbort.current?.abort(), []);

  const runSearch = useCallback(async (search: ActiveSearch) => {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setActive(search);
    setSearching(true);
    setSearchError(null);
    try {
      const next = await adminApi.zlibrarySearch(buildRequest(search), controller.signal);
      if (controller.signal.aborted) return;
      setResult(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      setResult(null);
      setSearchError(friendlyMessage(error));
    } finally {
      if (searchAbort.current === controller) {
        searchAbort.current = null;
        setSearching(false);
      }
    }
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = draftQuery.trim();
    if (!query) return;
    const from = parseYear(filters.yearFrom);
    const to = parseYear(filters.yearTo);
    if (from !== undefined && to !== undefined && from > to) {
      setFilterError("L’anno iniziale è successivo a quello finale.");
      return;
    }
    setFilterError(null);
    void runSearch({ query, filters, page: 1 });
  }

  function goToPage(page: number) {
    if (!active) return;
    void runSearch({ ...active, page });
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const filtersDirty = (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).some(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  );

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(next);
  }

  function rowKey(book: ZlibraryBook): string {
    return `${book.id}/${book.hash}`;
  }

  function setRowBusy(book: ZlibraryBook, kind: BusyKind | null) {
    setBusyRows((current) => {
      const next = { ...current };
      if (kind) next[rowKey(book)] = kind;
      else delete next[rowKey(book)];
      return next;
    });
  }

  function loadExplorations() {
    if (explorations.status === "loading" || explorations.status === "ready") return;
    setExplorations({ status: "loading", items: [], error: null });
    listExplorations()
      .then((items) => setExplorations({ status: "ready", items, error: null }))
      .catch((error: unknown) =>
        setExplorations({ status: "error", items: [], error: errorText(error) }),
      );
  }

  async function stageBook(book: ZlibraryBook) {
    setRowBusy(book, "stage");
    try {
      const upload = await adminApi.zlibraryStage(book.id, book.hash);
      onOpenChange(false);
      navigate(libraryPath("admin/upload"), { state: { zlibraryUpload: upload } });
    } catch (error) {
      toast.error(friendlyMessage(error));
    } finally {
      setRowBusy(book, null);
    }
  }

  /**
   * Downloads the EPUB and adds it to the exploration returned by `resolveTarget` (which may create it first).
   * A failure in `resolveTarget` leaves the caller's dialog open; later failures are only reported in a toast.
   */
  async function sendToExploration(
    book: ZlibraryBook,
    resolveTarget: () => Promise<ExplorationSummary>,
  ) {
    setRowBusy(book, "explore");
    try {
      const target = await resolveTarget();
      const { blob, fileName } = await adminApi.zlibraryEpub(book.id, book.hash);
      const file = new File([blob], fileName, { type: "application/epub+zip" });
      const updated = await addEpubToExploration(target.id, file);
      setAddedRows((current) => ({
        ...current,
        [rowKey(book)]: { id: updated.id, title: updated.title },
      }));
      toast.success(`«${book.title}» aggiunto a «${updated.title}»`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setRowBusy(book, null);
    }
  }

  /** Closes the sheet first: it is modal and would otherwise cover the exploration page. */
  function openExploration(id: string) {
    onOpenChange(false);
    navigate(`/explore/${id}`);
  }

  function openCreate(book: ZlibraryBook) {
    setNewTitle(book.title);
    setNewQuestion("");
    setCreateTarget(book);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const book = createTarget;
    const question = newQuestion.trim();
    if (!book || question === "") return;
    const title = newTitle.trim() || book.title;
    setCreating(true);
    await sendToExploration(book, async () => {
      const created = await createExploration({ title, question });
      // The dialog closes once the exploration exists: from here on, the work continues in the background.
      setCreateTarget(null);
      setExplorations((prev) =>
        prev.status === "ready" ? { ...prev, items: [created, ...prev.items] } : prev,
      );
      return created;
    });
    setCreating(false);
  }

  const books = result?.books ?? [];
  const page = active?.page ?? 1;
  const totalPages = result?.totalPages ?? null;
  const rawCount = result ? result.books.length + result.filteredOut : 0;
  const hasNext = totalPages !== null ? page < totalPages : rawCount >= PAGE_SIZE;
  const configured = status?.configured !== false;
  const quota = status?.quota ?? null;

  let resultsBody: ReactNode;
  if (statusError) {
    resultsBody = (
      <Alert variant="destructive">
        <AlertDescription>{statusError}</AlertDescription>
      </Alert>
    );
  } else if (status && !status.configured) {
    resultsBody = (
      <ZlibraryConnectForm onConnect={connect} busy={connecting} error={connectError} />
    );
  } else if (status?.error) {
    resultsBody = (
      <Alert variant="destructive">
        <AlertDescription>{status.error}</AlertDescription>
      </Alert>
    );
  } else if (searchError) {
    resultsBody = (
      <Alert variant="destructive">
        <AlertDescription>{searchError}</AlertDescription>
      </Alert>
    );
  } else if (searching) {
    resultsBody = (
      <ul className="grid gap-3 @md:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <ZlibraryResultSkeleton key={i} />
        ))}
      </ul>
    );
  } else if (!active) {
    resultsBody = (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <SearchIcon aria-hidden className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">Cerca un titolo, un autore o un ISBN.</p>
      </div>
    );
  } else if (result && books.length === 0) {
    resultsBody = (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <BookOpenIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Nessun risultato.</p>
        <p className="text-sm text-muted-foreground">Prova a togliere qualche filtro.</p>
      </div>
    );
  } else if (result) {
    resultsBody = (
      <ul className="grid gap-3 @md:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
        {books.map((book) => (
          <ZlibraryResultCard
            key={rowKey(book)}
            book={book}
            busy={busyRows[rowKey(book)]}
            added={addedRows[rowKey(book)]}
            explorations={explorations}
            onStage={() => void stageBook(book)}
            onLoadExplorations={loadExplorations}
            onPickExploration={(exploration) =>
              void sendToExploration(book, async () => exploration)
            }
            onNewExploration={() => openCreate(book)}
            onOpenExploration={openExploration}
          />
        ))}
      </ul>
    );
  }

  const countLabel = result
    ? [
        result.totalItems !== null
          ? `${result.totalItems.toLocaleString("it-IT")} risultati`
          : `${books.length} in questa pagina`,
        result.filteredOut > 0 ? `${result.filteredOut} nascosti dai filtri` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className={cn(
            "gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl",
            "transition-[max-width] duration-300 ease-out",
            expanded && "data-[side=right]:sm:max-w-[min(1400px,96vw)]",
          )}
        >
          <header className="shrink-0 space-y-3 border-b border-border bg-popover px-4 pt-4 pb-3">
            <div className="flex items-start gap-3 pr-12">
              <div className="min-w-0 flex-1">
                <SheetTitle className="font-serif text-xl font-medium">
                  Cerca su Z-Library
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">
                  Trova un EPUB e aggiungilo alla biblioteca o a un&apos;esplorazione.
                </SheetDescription>
              </div>
              {status?.configured && status.account ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void disconnect()}
                  title={`Collegato come ${status.account}`}
                  className="mt-0.5 shrink-0 text-xs"
                >
                  Esci
                </Button>
              ) : null}
              {quota && quota.limit > 0 ? (
                <span
                  className={cn(
                    "mt-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap tabular-nums",
                    quotaTone(quota.today, quota.limit),
                  )}
                >
                  {quota.today}/{quota.limit} download oggi
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleExpanded}
                aria-label={expanded ? "Riduci" : "Espandi"}
                title={expanded ? "Riduci" : "Espandi"}
                className="mt-0.5 shrink-0"
              >
                {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
              </Button>
            </div>

            <form onSubmit={onSubmit} aria-label="Ricerca su Z-Library" className="space-y-3">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={draftQuery}
                    onChange={(e) => setDraftQuery(e.target.value)}
                    placeholder="Titolo, autore o ISBN"
                    aria-label="Titolo, autore o ISBN"
                    maxLength={300}
                    className="h-11 rounded-full pl-10"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={draftQuery.trim() === "" || !configured}
                  className="h-11 rounded-full px-5"
                >
                  {searching ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
                  Cerca
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <FilterField label="Lingua" htmlFor="zl-language">
                  <Select
                    value={filters.language}
                    onValueChange={(v) => updateFilter("language", v)}
                  >
                    <SelectTrigger id="zl-language" size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Tutte</SelectItem>
                      {ZLIBRARY_LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <FilterField label="Formato" htmlFor="zl-format">
                  <Select value={filters.format} onValueChange={(v) => updateFilter("format", v)}>
                    <SelectTrigger id="zl-format" size="sm" className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EPUB">EPUB</SelectItem>
                      <SelectItem value={ALL}>Tutti</SelectItem>
                      {ZLIBRARY_EXTENSIONS.filter((ext) => ext !== "EPUB").map((ext) => (
                        <SelectItem key={ext} value={ext}>
                          {ext}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <div
                  className="flex flex-col gap-1"
                  role="group"
                  aria-label="Anno di pubblicazione"
                >
                  <span className="text-xs font-medium text-muted-foreground">Anno</span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="zl-year-from"
                      aria-label="Anno da"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={3000}
                      placeholder="Da"
                      value={filters.yearFrom}
                      onChange={(e) => updateFilter("yearFrom", e.target.value)}
                      className="h-8 w-20"
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <Input
                      id="zl-year-to"
                      aria-label="Anno a"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={3000}
                      placeholder="A"
                      value={filters.yearTo}
                      onChange={(e) => updateFilter("yearTo", e.target.value)}
                      className="h-8 w-20"
                    />
                  </div>
                </div>

                <FilterField label="Peso max" htmlFor="zl-size">
                  <Select value={filters.maxSize} onValueChange={(v) => updateFilter("maxSize", v)}>
                    <SelectTrigger id="zl-size" size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIZE_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                <FilterField label="Ordina" htmlFor="zl-order">
                  <Select value={filters.order} onValueChange={(v) => updateFilter("order", v)}>
                    <SelectTrigger id="zl-order" size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZLIBRARY_ORDERS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>

                {filtersDirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => {
                      setFilters(DEFAULT_FILTERS);
                      setFilterError(null);
                    }}
                  >
                    Azzera filtri
                  </Button>
                ) : null}
              </div>

              {filterError ? (
                <p role="alert" className="text-sm text-destructive">
                  {filterError}
                </p>
              ) : null}
            </form>
          </header>

          <div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {statusLoading && !status ? (
              <p className="mb-3 text-sm text-muted-foreground">Verifica dello stato…</p>
            ) : null}
            {resultsBody}
          </div>

          {result && active ? (
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-popover px-4 py-2.5">
              <p className="text-xs text-muted-foreground tabular-nums">{countLabel}</p>
              {!searchError ? (
                <nav aria-label="Paginazione" className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={searching || page <= 1}
                    onClick={() => goToPage(page - 1)}
                  >
                    Precedente
                  </Button>
                  <span className="px-2 text-sm tabular-nums text-muted-foreground">
                    {totalPages !== null ? `Pagina ${page} di ${totalPages}` : `Pagina ${page}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={searching || !hasNext}
                    onClick={() => goToPage(page + 1)}
                  >
                    Successiva
                  </Button>
                </nav>
              ) : null}
            </footer>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={createTarget !== null}
        onOpenChange={(next) => {
          if (!next && !creating) setCreateTarget(null);
        }}
      >
        <DialogContent>
          <form onSubmit={submitCreate} className="grid gap-6">
            <DialogHeader>
              <DialogTitle className="font-serif">Nuova esplorazione</DialogTitle>
              <DialogDescription>
                Crea un&apos;esplorazione e aggiungi «{createTarget?.title}».
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="zl-explore-title">Titolo</Label>
                <Input
                  id="zl-explore-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="zl-explore-question">Domanda</Label>
                <Textarea
                  id="zl-explore-question"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Cosa vuoi capire da questo libro?"
                  required
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateTarget(null)}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={creating || newQuestion.trim() === ""}>
                {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                Crea e aggiungi
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Z-Library sign-in, shown until the user connects their own account: the password is sent once and never kept. */
function ZlibraryConnectForm({
  onConnect,
  busy,
  error,
}: {
  onConnect: (email: string, password: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    void onConnect(email.trim(), password).then(() => setPassword(""));
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-sm flex-col gap-3 py-6">
      <p className="text-sm text-muted-foreground">
        Collega il tuo account Z-Library. La password serve solo per questo accesso: l&apos;app conserva soltanto la
        chiave di sessione.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zlibrary-email">Email</Label>
        <Input
          id="zlibrary-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zlibrary-password">Password</Label>
        <Input
          id="zlibrary-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy || email.trim() === "" || password === ""}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        Collega
      </Button>
    </form>
  );
}
