/** "Sintesi" section of the public book page: the book summary and one collapsible item per summarized chapter. */
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { BookDetail } from "@shared/schema";
import { formatDate, formatLanguage, paragraphs } from "@library/lib/format";

export const SUMMARY_SECTION_ID = "sintesi";
export const SUMMARY_SECTION_TITLE = "Sintesi";

/** From this many summarized chapters on, the "Espandi tutto / Comprimi tutto" toggle is shown. */
const EXPAND_ALL_THRESHOLD = 3;

export type BookSummaryData = NonNullable<BookDetail["summary"]>;

interface ChapterItem {
  n: number;
  title: string;
  text: string;
}

export function BookSummarySection({ summary }: { summary: BookSummaryData }) {
  const chapters: ChapterItem[] = summary.chapters.flatMap((c) =>
    c.summary === null ? [] : [{ n: c.n, title: c.title, text: c.summary }],
  );
  const [openByChapter, setOpenByChapter] = useState<Record<number, boolean>>({});
  const allOpen = chapters.length > 0 && chapters.every((c) => openByChapter[c.n] === true);

  function toggleAll() {
    const next = !allOpen;
    setOpenByChapter(Object.fromEntries(chapters.map((c) => [c.n, next])));
  }

  function setChapterOpen(n: number, open: boolean) {
    // Native toggles reach us through onToggle; keep the state in step with what the user did.
    setOpenByChapter((prev) => (prev[n] === open ? prev : { ...prev, [n]: open }));
  }

  const generatedOn = formatDate(summary.generatedAt.slice(0, 10));
  const language = summary.language !== "it" ? ` in ${formatLanguage(summary.language)}` : "";

  return (
    <section aria-labelledby={SUMMARY_SECTION_ID} className="mt-14">
      <h2
        id={SUMMARY_SECTION_ID}
        tabIndex={-1}
        className="flex scroll-mt-6 items-center gap-4 text-3xl font-medium tracking-tight outline-none sm:text-[2.125rem]"
      >
        {SUMMARY_SECTION_TITLE}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </h2>

      <div className="prose-book mt-6">
        {paragraphs(summary.book).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {chapters.length > 0 ? (
        <div className="mt-10 max-w-[44rem]">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-sans text-xs font-semibold tracking-[0.16em] text-brand uppercase">
              Capitoli
            </h3>
            {chapters.length > EXPAND_ALL_THRESHOLD ? (
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
              >
                {allOpen ? "Comprimi tutto" : "Espandi tutto"}
              </button>
            ) : null}
          </div>

          <ul className="mt-3 divide-y divide-border/80 border-y border-border/80">
            {chapters.map((chapter) => (
              <li key={chapter.n}>
                <details
                  open={openByChapter[chapter.n] === true}
                  onToggle={(event) => setChapterOpen(chapter.n, event.currentTarget.open)}
                  className="group"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                    <span className="w-7 shrink-0 text-sm text-muted-foreground tabular-nums">
                      {chapter.n}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{chapter.title}</span>
                    <ChevronDownIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="prose-book prose-book--compact pb-4 pl-10">
                    {paragraphs(chapter.text).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-8 text-sm text-muted-foreground">
        Sintesi generata da {summary.model} il {generatedOn}
        {language}
      </p>
    </section>
  );
}
