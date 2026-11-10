import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CirclePlay,
  Headphones,
  NotebookText,
  Play,
  Sparkles,
} from "lucide-react";
import type { Episode, Show } from "@core/schema";
import { extractYoutubeId } from "@core/urls";
import { ConversationsSection } from "@podcasts/components/conversations";
import { EpisodeImage } from "@podcasts/components/episode-image";
import { Markdown } from "@podcasts/components/lazy-markdown";
import { useDocumentTitle } from "@podcasts/components/site-layout";
import { Button } from "@ehub/ui/components/button";
import { type NoteItemRef, NoteThread, NotesJumpLink } from "@ehub/notes";
import { DevSlot } from "@podcasts/dev-slot";
import { filtersToSearch, EMPTY_FILTERS } from "@podcasts/lib/filters";
import { formatCalendarDate, formatInstant } from "@podcasts/lib/format";
import { episodeImageCandidates, showImageUrl } from "@podcasts/lib/images";
import { episodePath, homePath } from "@podcasts/lib/paths";
import { timestampPattern, timestampVideoId, youtubeWatchUrl } from "@podcasts/lib/timestamps";
import { NotFoundPage } from "@podcasts/pages/not-found";
import { useSiteData } from "@podcasts/site-data";

export function EpisodeRoute() {
  const { slug = "" } = useParams();
  const { catalog } = useSiteData();
  const episode = catalog.episodesBySlug.get(slug);
  if (!episode) {
    return (
      <NotFoundPage
        title="Episodio non trovato"
        message={`Nessun episodio corrisponde a «${slug}». Forse è stato rinominato o rimosso.`}
      />
    );
  }
  // Keyed: navigating to another episode starts from a fresh page state.
  return (
    <EpisodePage
      key={episode.slug}
      episode={episode}
      show={catalog.showsBySlug.get(episode.show)}
    />
  );
}

const SECTION_HEADING =
  "flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-balance";

const linkToFilters = (filters: Partial<typeof EMPTY_FILTERS>) =>
  homePath(filtersToSearch({ ...EMPTY_FILTERS, ...filters }));

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function EpisodePage({ episode, show }: { episode: Episode; show: Show | undefined }) {
  useDocumentTitle(episode.title);
  const videoId = timestampVideoId(episode);
  const watchUrl = episode.youtubeId ? youtubeWatchUrl(episode.youtubeId) : undefined;
  const originalIsVideo =
    episode.youtubeId !== undefined && extractYoutubeId(episode.url) === episode.youtubeId;
  const showImage = showImageUrl(show);
  const hasSummary = episode.summary.length > 0;
  const hasNotes = episode.notes.trim() !== "";
  const noteItem: NoteItemRef = {
    module: "podcasts",
    id: episode.slug,
    title: episode.title,
    subtitle: show?.name ?? episode.show,
    href: episodePath(episode.slug),
  };
  const feedTimestamps =
    episode.transcriptTimebase === "feed" && timestampPattern().test(episode.notes);

  return (
    <article className="max-w-3xl pt-6 sm:pt-10">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <DevSlot name="header-actions" />
      </div>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link
            to={linkToFilters({ shows: [episode.show] })}
            className="-m-1 inline-flex items-center gap-2 rounded-md p-1 font-medium transition-colors outline-none hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
            title="Tutti gli episodi di questo show"
          >
            {showImage && (
              <img src={showImage} alt="" className="size-6 rounded-md bg-muted object-cover" />
            )}
            {show?.name ?? episode.show}
          </Link>
          {episode.number !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">Episodio {episode.number}</span>
            </>
          )}
        </div>

        <h1 className="mt-3 font-serif text-[1.9rem] leading-tight font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.15]">
          {episode.title}
        </h1>

        <DevSlot name="episode-meta" episode={episode}>
          <EpisodeMeta episode={episode} />
        </DevSlot>

        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          {episode.publishedAt && (
            <li className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              Pubblicato{" "}
              <time dateTime={episode.publishedAt} className="font-medium text-brand">
                {formatCalendarDate(episode.publishedAt, "long")}
              </time>
            </li>
          )}
          <li className="inline-flex items-center gap-1.5">
            <Headphones className="size-4" aria-hidden />
            Aggiunto{" "}
            <time dateTime={episode.addedAt} className="font-medium text-brand">
              {formatInstant(episode.addedAt, "long")}
            </time>
          </li>
          <DevSlot name="episode-transcript" episode={episode}>
            {import.meta.env.DEV && !episode.transcriptSource && (
              <li className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs">
                Nessuna trascrizione
              </li>
            )}
          </DevSlot>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {watchUrl && (
            <Button asChild>
              <a href={watchUrl} target="_blank" rel="noopener noreferrer">
                <CirclePlay aria-hidden /> Guarda su YouTube
              </a>
            </Button>
          )}
          {!originalIsVideo && (
            <Button asChild variant={watchUrl ? "outline" : "default"}>
              <a href={episode.url} target="_blank" rel="noopener noreferrer">
                Episodio originale
                {hostname(episode.url) && (
                  <span className="font-normal opacity-60">{hostname(episode.url)}</span>
                )}
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
          )}
          <NotesJumpLink item={noteItem} />
          <DevSlot name="episode-actions" episode={episode} show={show} />
        </div>
      </header>

      <a
        href={watchUrl ?? episode.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative mt-8 block overflow-hidden rounded-2xl bg-muted shadow-sm ring-1 ring-foreground/5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={watchUrl ? "Guarda l'episodio su YouTube" : "Apri l'episodio originale"}
      >
        <EpisodeImage
          candidates={episodeImageCandidates(episode, show, "detail")}
          alt=""
          loading="eager"
          className="transition-transform duration-500 group-hover:scale-[1.015]"
        />
        {watchUrl && (
          <span className="absolute inset-0 grid place-items-center bg-foreground/0 transition-colors group-hover:bg-foreground/15">
            <span className="grid size-16 place-items-center rounded-full bg-foreground/70 text-background opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Play className="ml-1 size-7 fill-current" aria-hidden />
            </span>
          </span>
        )}
      </a>

      <DevSlot name="episode-summary" episode={episode}>
        {hasSummary && (
          <section
            aria-labelledby="summary-heading"
            className="mt-10 rounded-2xl border bg-muted/40 p-5 sm:p-7"
          >
            <h2 id="summary-heading" className={SECTION_HEADING}>
              <Sparkles className="size-5 text-brand" aria-hidden />
              In breve
            </h2>
            <ul className="mt-4 space-y-3">
              {episode.summary.map((point, index) => (
                <li key={index} className="flex gap-3 text-base leading-relaxed sm:text-[1.075rem]">
                  <span
                    className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-brand"
                    aria-hidden
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DevSlot>

      <DevSlot name="episode-notes" episode={episode}>
        {hasNotes && (
          <section aria-labelledby="notes-heading" className="mt-12">
            <h2 id="notes-heading" className={SECTION_HEADING}>
              <NotebookText className="size-5 text-brand" aria-hidden />
              Appunti
            </h2>
            {feedTimestamps && (
              <p className="mt-2 text-sm text-muted-foreground">
                I timestamp si riferiscono all'audio del feed e non corrispondono al video.
              </p>
            )}
            <Markdown timestampVideoId={videoId} className="mt-5">
              {episode.notes}
            </Markdown>
          </section>
        )}
      </DevSlot>

      {!hasSummary && !hasNotes && (
        <p className="mt-10 rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          Ancora nessun appunto su questo episodio.
        </p>
      )}

      <NoteThread item={noteItem} noun="questo episodio" className="mt-12 border-t pt-8 sm:mt-14" />

      <ConversationsSection episode={episode} timestampVideoId={videoId} />
    </article>
  );
}

function EpisodeMeta({ episode }: { episode: Episode }) {
  if (episode.guests.length === 0 && episode.tags.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      {episode.guests.length > 0 && (
        <p className="text-lg text-muted-foreground">
          con{" "}
          {episode.guests.map((guest, index) => (
            <span key={guest}>
              {index > 0 && (index === episode.guests.length - 1 ? " e " : ", ")}
              <Link
                to={linkToFilters({ q: guest })}
                className="rounded-sm font-semibold text-foreground underline decoration-brand/30 underline-offset-4 transition-colors outline-none hover:text-brand hover:decoration-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                title={`Cerca «${guest}» negli episodi`}
              >
                {guest}
              </Link>
            </span>
          ))}
        </p>
      )}
      {episode.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tag">
          {episode.tags.map((tag) => (
            <li key={tag}>
              <Link
                to={linkToFilters({ tags: [tag] })}
                className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:border-brand/40 hover:bg-brand-soft hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                title={`Episodi con il tag «${tag}»`}
              >
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Back to the list: returns to the same filtered view (and scroll position) when we came from it. */
function BackLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const listSearch = (location.state as { listSearch?: unknown } | null)?.listSearch;
  const fromList = typeof listSearch === "string";
  return (
    <Link
      to={homePath(fromList ? listSearch : "")}
      onClick={(event) => {
        if (!fromList || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        void navigate(-1);
      }}
      className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Tutti gli episodi
    </Link>
  );
}
