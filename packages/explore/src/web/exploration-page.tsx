import { ArrowLeftIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { NoteMarkdown } from "@ehub/notes";
import { Container, PageHeader } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { Badge } from "@ehub/ui/components/badge";
import { formatVerdict } from "../labels.ts";
import type { BookSource, Exploration, Note } from "../schema.ts";
import {
  DevExplorationToolbar,
  DevKoboButton,
  DevNoteComposer,
  DevNoteDelete,
  DevNotebookEditor,
  DevSourceActions,
  DevTagsEditor,
} from "./dev-slots.tsx";
import {
  ORIGIN_LABELS,
  STATUS_LABELS,
  VIA_LABELS,
  formatDay,
  libraryBookHref,
} from "./format.ts";
import type { ZlibraryPicker } from "./integrations.ts";
import { NotebookView } from "./notebook-view.tsx";
import { SummaryLine, useSummaryStatus } from "./summary-status.tsx";
import { ExploreErrorBanner, MessageState } from "./status.tsx";
import {
  type BookSummaryStatus,
  ExploreApiError,
  type ExploreStore,
  exploreStore,
  useExploration,
} from "./store.ts";

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "missing" }
  | { status: "error"; message: string };

function SectionTitle({ id, children, count }: { id: string; children: string; count?: number }) {
  return (
    <h2
      id={id}
      className="flex scroll-mt-6 items-center gap-4 font-serif text-2xl font-medium tracking-tight sm:text-[1.75rem]"
    >
      {children}
      {count !== undefined ? (
        <span className="font-sans text-base font-normal text-muted-foreground">{count}</span>
      ) : null}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </h2>
  );
}

function SourceRow({
  exploration,
  source,
  store,
  devTools,
  summary,
  onRetrySummary,
}: {
  exploration: Exploration;
  source: BookSource;
  store: ExploreStore;
  devTools: boolean;
  /** Chapter-summary status (local dev only; undefined elsewhere). */
  summary?: BookSummaryStatus;
  onRetrySummary?: (bookId: string) => Promise<void>;
}) {
  return (
    <li className="flex flex-col gap-2 border-t border-border/80 py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-serif text-xl leading-snug font-medium break-words">{source.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground break-words">
          {[source.authors.join(", "), source.language?.toUpperCase()].filter(Boolean).join(" · ")}
          {source.authors.length || source.language ? " · " : ""}
          {ORIGIN_LABELS[source.origin]}
        </p>
        {source.origin === "library" ? (
          <Link
            to={libraryBookHref(source.id)}
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            Apri la pagina del libro <ExternalLinkIcon aria-hidden className="size-3.5" />
          </Link>
        ) : null}
        <SummaryLine status={summary} onRetry={onRetrySummary} />
      </div>
      <div className="flex min-w-0 flex-col gap-1 sm:max-w-[60%] sm:items-end sm:text-right">
        <Badge variant={source.verdict ? "secondary" : "outline"}>
          {formatVerdict(source.verdict)}
        </Badge>
        {source.verdict?.reason ? (
          <p className="text-sm text-muted-foreground break-words">{source.verdict.reason}</p>
        ) : null}
        {devTools && DevSourceActions ? (
          <Suspense fallback={null}>
            <DevSourceActions exploration={exploration} source={source} store={store} />
          </Suspense>
        ) : null}
      </div>
    </li>
  );
}

function NoteItem({
  exploration,
  note,
  store,
  devTools,
}: {
  exploration: Exploration;
  note: Note;
  store: ExploreStore;
  devTools: boolean;
}) {
  const book = note.book ? exploration.sources.find((s) => s.id === note.book) : undefined;
  return (
    <li className="border-t border-border/80 py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <time dateTime={note.createdAt}>{formatDay(note.createdAt)}</time>
        {book ? <span>su «{book.title}»</span> : null}
        {devTools && DevNoteDelete ? (
          <Suspense fallback={null}>
            <DevNoteDelete exploration={exploration} noteId={note.id} store={store} />
          </Suspense>
        ) : null}
      </div>
      <NoteMarkdown text={note.body} className="mt-1.5" />
    </li>
  );
}

/** One exploration: question, sources with verdicts, notebook, summary, notes and journal. Read-only unless `devTools`. */
export function ExplorationPage({
  store = exploreStore,
  devTools = import.meta.env.DEV,
  zlibrary,
}: {
  store?: ExploreStore;
  zlibrary?: ZlibraryPicker;
  /** Show the local-only actions (default: only in the dev server). */
  devTools?: boolean;
}) {
  const { id: rawId = "" } = useParams();
  const exploration = useExploration(rawId, store);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const summaries = useSummaryStatus(rawId, { enabled: devTools, store, updatedAt: exploration?.updatedAt });
  const [synthesisError, setSynthesisError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoad({ status: "loading" });
    store.fetchOne(rawId).then(
      () => {
        if (current) setLoad({ status: "ready" });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ExploreApiError && error.status === 404) setLoad({ status: "missing" });
        else setLoad({ status: "error", message: (error as Error).message });
      },
    );
    return () => {
      current = false;
    };
  }, [rawId, store]);

  useEffect(() => {
    document.title = `${exploration?.title ?? "Esplorazione"} · e-hub`;
  }, [exploration?.title]);

  const back = (
    <Link
      to="/explore"
      className="group -ml-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-brand"
    >
      <ArrowLeftIcon aria-hidden className="size-4 transition-transform group-hover:-translate-x-0.5" />
      Tutte le esplorazioni
    </Link>
  );

  if (!exploration) {
    return (
      <Container className="pt-6 pb-16 sm:pt-8">
        {back}
        {load.status === "missing" ? (
          <MessageState title="Esplorazione non trovata">
            <p>Controlla il link o torna all’elenco.</p>
          </MessageState>
        ) : load.status === "error" ? (
          <ExploreErrorBanner store={store} className="mt-8" />
        ) : (
          <p className="mt-10 text-sm text-muted-foreground" aria-busy>
            Caricamento…
          </p>
        )}
      </Container>
    );
  }

  return (
    <Container className="pt-6 pb-16 sm:pt-8">
      <article>
        {back}

        {load.status === "error" ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Impossibile aggiornare l’esplorazione: {load.message}
          </p>
        ) : null}

        <PageHeader
          className="pt-4 pb-0 sm:pt-6"
          eyebrow={
            <span className="flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.16em] text-brand uppercase">
              {STATUS_LABELS[exploration.status]} · {formatDay(exploration.createdAt)}
            </span>
          }
          title={exploration.title}
          description={
            <span className="font-serif text-xl text-foreground/80 italic sm:text-2xl">
              {exploration.question}
            </span>
          }
        />

        {devTools && DevTagsEditor ? (
          <div className="mt-4">
            <Suspense fallback={null}>
              <DevTagsEditor exploration={exploration} store={store} />
            </Suspense>
          </div>
        ) : exploration.tags && exploration.tags.length > 0 ? (
          <ul aria-label="Tag" className="mt-4 flex flex-wrap gap-1.5">
            {exploration.tags.map((tag) => (
              <li key={tag}>
                <Badge variant="outline">{tag}</Badge>
              </li>
            ))}
          </ul>
        ) : null}

        {devTools && DevExplorationToolbar ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Suspense fallback={null}>
              <DevExplorationToolbar exploration={exploration} store={store} zlibrary={zlibrary} />
            </Suspense>
            {DevKoboButton ? (
              <Suspense fallback={null}>
                <DevKoboButton ids={[exploration.id]} store={store} iconOnly />
              </Suspense>
            ) : null}
          </div>
        ) : null}

        <section aria-labelledby="fonti" className="mt-10 max-w-[48rem]">
          <SectionTitle id="fonti" count={exploration.sources.length}>
            Fonti
          </SectionTitle>
          {exploration.sources.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nessuna fonte ancora.</p>
          ) : (
            <ul className="mt-6">
              {exploration.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  exploration={exploration}
                  source={source}
                  store={store}
                  devTools={devTools}
                  summary={summaries.statuses.get(source.id)}
                  onRetrySummary={summaries.retry}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="quaderno" className="mt-12 max-w-[48rem]">
          <SectionTitle id="quaderno">Quaderno</SectionTitle>
          {devTools && DevNotebookEditor ? (
            <div className="mt-6">
              <Suspense
                fallback={<NotebookView notebook={exploration.notebook} />}
              >
                <DevNotebookEditor exploration={exploration} store={store} />
              </Suspense>
            </div>
          ) : (
            <div className="mt-6">
              <NotebookView notebook={exploration.notebook} />
            </div>
          )}
        </section>

        <section aria-labelledby="sintesi" className="mt-12 max-w-[48rem]">
          <SectionTitle id="sintesi">Sintesi</SectionTitle>
          {exploration.synthesis ? (
            <p className="mt-6 text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words">
              {exploration.synthesis.body}
            </p>
          ) : null}
          {exploration.summary ? (
            <div className="mt-6">
              {exploration.synthesis ? <h3 className="text-sm font-medium">Sintesi della sessione</h3> : null}
              <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words">
                {exploration.summary}
              </p>
            </div>
          ) : !exploration.synthesis && summaries.synthesis?.state !== "running" ? (
            <p className="mt-6 text-sm text-muted-foreground">Nessuna sintesi ancora.</p>
          ) : null}
          {summaries.synthesis?.state === "running" ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">Aggiornamento della sintesi in corso…</p>
          ) : null}
          {summaries.synthesis?.state === "failed" || summaries.synthesis?.state === "none" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {summaries.synthesis.state === "failed" ? (
                <p role="alert" className="text-sm text-destructive">Aggiornamento della sintesi non riuscito.</p>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSynthesisError(null);
                  void summaries.retrySynthesis().catch((error: unknown) => {
                    setSynthesisError((error as Error).message);
                  });
                }}
              >
                <SparklesIcon aria-hidden />
                {summaries.synthesis.state === "failed" ? "Riprova la sintesi" : "Genera sintesi"}
              </Button>
            </div>
          ) : null}
          {synthesisError ? <p role="alert" className="mt-2 text-sm text-destructive">{synthesisError}</p> : null}
        </section>

        <section aria-labelledby="note" className="mt-12 max-w-[48rem]">
          <SectionTitle id="note" count={exploration.notes.length}>
            Note
          </SectionTitle>
          {exploration.notes.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nessuna nota ancora.</p>
          ) : (
            <ul className="mt-6">
              {exploration.notes.map((note) => (
                <NoteItem
                  key={note.id}
                  exploration={exploration}
                  note={note}
                  store={store}
                  devTools={devTools}
                />
              ))}
            </ul>
          )}
          {devTools && DevNoteComposer ? (
            <div className="mt-6">
              <Suspense fallback={null}>
                <DevNoteComposer exploration={exploration} store={store} />
              </Suspense>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="diario" className="mt-12 max-w-[48rem]">
          <SectionTitle id="diario" count={exploration.journal.length}>
            Diario
          </SectionTitle>
          {exploration.journal.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nessuna voce ancora.</p>
          ) : (
            <ol className="mt-6 flex flex-col gap-5">
              {exploration.journal.map((entry) => (
                <li key={`${entry.at}-${entry.text.slice(0, 16)}`} className="border-l-2 border-brand/40 pl-4">
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={entry.at}>{formatDay(entry.at)}</time> · {VIA_LABELS[entry.via]}
                  </p>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words">
                    {entry.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>
    </Container>
  );
}
