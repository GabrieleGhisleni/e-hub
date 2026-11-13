import { CompassIcon } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import { Container, PageHeader } from "@ehub/ui";
import { Badge } from "@ehub/ui/components/badge";
import { formatVerdict } from "../labels.ts";
import type { Exploration } from "../schema.ts";
import { DevExplorationNewLink } from "./dev-slots.tsx";
import { STATUS_LABELS, explorationHref, formatDay } from "./format.ts";
import { ExploreErrorBanner, MessageState } from "./status.tsx";
import { type ExploreStore, exploreStore, useExploreMeta, useExplorations } from "./store.ts";

/** Sources shown per card before the rest is folded into "e altri N". */
const SOURCES_PREVIEW = 4;

function ExplorationCard({ exploration }: { exploration: Exploration }) {
  const shown = exploration.sources.slice(0, SOURCES_PREVIEW);
  const hidden = exploration.sources.length - shown.length;
  return (
    <li>
      <Link
        to={explorationHref(exploration.id)}
        className="group block rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={exploration.status === "open" ? "secondary" : "outline"}>
            {STATUS_LABELS[exploration.status]}
          </Badge>
          <time dateTime={exploration.createdAt}>{formatDay(exploration.createdAt)}</time>
        </div>
        <h2 className="mt-3 font-serif text-2xl leading-tight font-medium tracking-tight text-balance group-hover:text-brand">
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

        {exploration.summary ? (
          <p className="mt-4 line-clamp-3 text-sm text-foreground/75">{exploration.summary}</p>
        ) : null}
      </Link>
    </li>
  );
}

/** All explorations, newest first. Read-only on the published site. */
export function ExplorationListPage({
  store = exploreStore,
  devTools = import.meta.env.DEV,
}: {
  store?: ExploreStore;
  /** Show the local-only actions (default: only in the dev server). */
  devTools?: boolean;
}) {
  const all = useExplorations(store);
  const meta = useExploreMeta(store);

  useEffect(() => {
    document.title = "Esplorazioni · e-hub";
  }, []);

  return (
    <Container className="pt-6 pb-16 sm:pt-8">
      <PageHeader
        title="Esplorazioni"
        description={
          <span>
            Domande poste ai libri: prima si esplora, poi si decide cosa leggere.
          </span>
        }
        actions={devTools && DevExplorationNewLink ? <DevExplorationNewLink /> : undefined}
      />

      <ExploreErrorBanner store={store} className="mt-6" />

      {meta.status === "loading" && all.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground" aria-busy>
          Caricamento…
        </p>
      ) : all.length === 0 ? (
        <MessageState icon={<CompassIcon aria-hidden />} title="Nessuna esplorazione ancora">
          <p>Un’esplorazione raccoglie una domanda, i libri su cui cercare la risposta e i verdetti.</p>
        </MessageState>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {all.map((exploration) => (
            <ExplorationCard key={exploration.id} exploration={exploration} />
          ))}
        </ul>
      )}

    </Container>
  );
}
