import { Link } from "react-router";
import type { Episode, Show } from "@core/schema";
import { NoteCountBadge } from "@ehub/notes";
import { EpisodeImage } from "@podcasts/components/episode-image";
import { formatCalendarDate, formatInstant, formatList } from "@podcasts/lib/format";
import { episodeImageCandidates } from "@podcasts/lib/images";
import { episodePath } from "@podcasts/lib/paths";
import { cn } from "@podcasts/lib/utils";

interface EpisodeRowProps {
  episode: Episode;
  show: Show | undefined;
  /** Tags currently filtered on (highlighted). */
  activeTags: readonly string[];
  onToggleTag: (tag: string) => void;
  /** Query string of the list, so "back" from the detail page returns to the same view. */
  listSearch: string;
}

/** One dense row of the home list (DESIGN.md §8.3). The whole row links to the detail page. */
export function EpisodeRow({
  episode,
  show,
  activeTags,
  onToggleTag,
  listSearch,
}: EpisodeRowProps) {
  const showLabel = show?.name ?? episode.show;
  return (
    <article className="group relative grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-xl p-3 transition-colors hover:bg-muted/50 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-5 sm:p-4">
      <EpisodeImage
        candidates={episodeImageCandidates(episode, show, "list")}
        alt=""
        className="rounded-lg ring-1 ring-foreground/5 sm:row-span-3"
      />
      <div className="min-w-0 self-center sm:self-start">
        <h3 className="font-serif text-[1.05rem] leading-snug font-semibold tracking-tight text-pretty sm:text-[1.35rem]">
          <Link
            to={episodePath(episode.slug)}
            state={{ listSearch }}
            className="rounded-sm transition-colors outline-none group-hover:text-brand after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {episode.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {episode.guests.length > 0 && (
            <>
              <span className="font-medium text-foreground/80">{formatList(episode.guests)}</span>
              <span aria-hidden> · </span>
            </>
          )}
          <span>
            {showLabel}
            {episode.number !== undefined && (
              <span className="tabular-nums"> #{episode.number}</span>
            )}
          </span>
          <span aria-hidden> · </span>
          {episode.publishedAt ? (
            <time dateTime={episode.publishedAt} className="tabular-nums text-brand">
              {formatCalendarDate(episode.publishedAt)}
            </time>
          ) : (
            <span>
              aggiunto{" "}
              <time dateTime={episode.addedAt} className="text-brand">
                {formatInstant(episode.addedAt)}
              </time>
            </span>
          )}
          <NoteCountBadge module="podcasts" id={episode.slug} className="ml-2 align-[1px]" />
          {import.meta.env.DEV && !episode.transcriptSource && (
            <span className="ml-2 inline-flex rounded-full border border-dashed px-1.5 text-xs whitespace-nowrap">
              nessuna trascrizione
            </span>
          )}
        </p>
      </div>
      {episode.summary.length > 0 && (
        <ul
          className="col-span-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:col-span-1 sm:col-start-2"
          aria-label="In breve"
        >
          {episode.summary.map((point, index) => (
            <li key={index} className="inline">
              {index > 0 && (
                <span className="mx-1.5 text-muted-foreground/50" aria-hidden>
                  •
                </span>
              )}
              {point}
            </li>
          ))}
        </ul>
      )}
      {episode.tags.length > 0 && (
        <ul
          className="pointer-events-none relative z-10 col-span-2 flex flex-wrap gap-1.5 sm:col-span-1 sm:col-start-2"
          aria-label="Tag"
        >
          {episode.tags.map((tag) => {
            const active = activeTags.includes(tag);
            return (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  aria-pressed={active}
                  title={active ? `Togli il filtro «${tag}»` : `Filtra per «${tag}»`}
                  className={cn(
                    "pointer-events-auto rounded-full border px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "border-brand/30 bg-brand-soft text-brand"
                      : "border-border bg-background/60 text-muted-foreground hover:border-brand/40 hover:text-brand",
                  )}
                >
                  {tag}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
