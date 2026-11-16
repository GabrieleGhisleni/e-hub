/**
 * "Sottolineature": the passages highlighted on the Kobo (pulled by `elib sync`), in the order of the book, grouped by
 * chapter. Each passage is a quote with its page; the comment typed on the Kobo, when there is one, sits under it.
 */
import { MessageSquareTextIcon } from "lucide-react";
import type { PublicHighlight } from "@shared/schema";
import { CollapsibleBox } from "./collapsible-box";

export const HIGHLIGHTS_SECTION_ID = "sottolineature";
export const HIGHLIGHTS_SECTION_TITLE = "Sottolineature";

interface ChapterGroup {
  chapter: string | undefined;
  items: PublicHighlight[];
}

/** Consecutive highlights of the same chapter, in the given (reading) order. */
export function groupByChapter(highlights: readonly PublicHighlight[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const highlight of highlights) {
    const last = groups.at(-1);
    if (last && last.chapter === highlight.chapter) last.items.push(highlight);
    else groups.push({ chapter: highlight.chapter, items: [highlight] });
  }
  return groups;
}

export function BookHighlightsSection({ highlights }: { highlights: readonly PublicHighlight[] }) {
  if (highlights.length === 0) return null;
  const groups = groupByChapter(highlights);
  return (
    <CollapsibleBox
      id={HIGHLIGHTS_SECTION_ID}
      title={HIGHLIGHTS_SECTION_TITLE}
      count={highlights.length}
      defaultOpen={false}
    >
      <div className="flex flex-col gap-8 pt-5">
        {groups.map((group, g) => (
          <section key={g} aria-label={group.chapter ?? "Senza capitolo"}>
            {group.chapter ? (
              <h3 className="flex items-center gap-3 font-sans text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                {group.chapter}
                <span aria-hidden className="h-px flex-1 bg-brand/15" />
              </h3>
            ) : null}
            <ol className="mt-3 flex flex-col gap-3">
              {group.items.map((h, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
                  <figure className="min-w-0 border-l-2 border-brand/50 pl-4">
                    <blockquote className="max-w-[70ch] font-serif text-[1.0625rem] leading-relaxed text-foreground/90 sm:text-lg">
                      {h.text}
                    </blockquote>
                    {h.note ? (
                      <figcaption className="mt-2 flex max-w-[70ch] gap-2 rounded-lg bg-brand-soft/60 px-3 py-2 text-sm leading-relaxed text-foreground">
                        <MessageSquareTextIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                        <span className="min-w-0 whitespace-pre-wrap">{h.note}</span>
                      </figcaption>
                    ) : null}
                  </figure>
                  {h.page ? (
                    <span
                      className="pt-1 text-xs text-muted-foreground tabular-nums"
                      title="Pagina sul Kobo (cambia con carattere e impaginazione)"
                    >
                      p. {h.page}
                    </span>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </CollapsibleBox>
  );
}
