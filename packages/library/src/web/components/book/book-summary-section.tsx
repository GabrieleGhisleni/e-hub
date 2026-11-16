/**
 * The summary of the public book page, in two pieces: the book summary ("Sintesi", next to the cover) and the
 * summarized chapters ("Capitoli", a full-width box that folds, one collapsible item per chapter).
 */
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { BookDetail } from "@shared/schema";
import { formatDate, formatLanguage, paragraphs } from "@library/lib/format";
import { CollapsibleBox } from "./collapsible-box";

export const SUMMARY_SECTION_ID = "sintesi";
export const SUMMARY_SECTION_TITLE = "Sintesi";
export const CHAPTERS_SECTION_ID = "capitoli";
export const CHAPTERS_SECTION_TITLE = "Capitoli";

/** From this many summarized chapters on, the "Espandi tutto / Comprimi tutto" toggle is shown. */
const EXPAND_ALL_THRESHOLD = 3;

export type BookSummaryData = NonNullable<BookDetail["summary"]>;

interface ChapterItem {
  n: number;
  title: string;
  text: string;
}

/** Chapters that have a summary (cover, copyright, index… have none and are left out). */
export function summarizedChapters(summary: BookSummaryData): ChapterItem[] {
  return summary.chapters.flatMap((c) =>
    c.summary === null ? [] : [{ n: c.n, title: c.title, text: c.summary }],
  );
}

/** "Sintesi": the summary of the whole book and the line saying which model wrote it. */
export function BookSummarySection({ summary }: { summary: BookSummaryData }) {
  const generatedOn = formatDate(summary.generatedAt.slice(0, 10));
  const language = summary.language !== "it" ? ` in ${formatLanguage(summary.language)}` : "";
  return (
    <section aria-labelledby={SUMMARY_SECTION_ID}>
      <h2
        id={SUMMARY_SECTION_ID}
        tabIndex={-1}
        className="flex scroll-mt-6 items-center gap-4 text-2xl font-medium tracking-tight outline-none sm:text-3xl"
      >
        {SUMMARY_SECTION_TITLE}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </h2>
      <div className="prose-book mt-5">
        {paragraphs(summary.book).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Sintesi generata da {summary.model} il {generatedOn}
        {language}
      </p>
    </section>
  );
}

/** "Capitoli": full-width box, folded with its header; each chapter opens on its own (closed by default). */
export function BookChaptersSection({ summary }: { summary: BookSummaryData }) {
  const chapters = summarizedChapters(summary);
  const [openByChapter, setOpenByChapter] = useState<Record<number, boolean>>({});
  if (chapters.length === 0) return null;
  const allOpen = chapters.every((c) => openByChapter[c.n] === true);

  function toggleAll() {
    const next = !allOpen;
    setOpenByChapter(Object.fromEntries(chapters.map((c) => [c.n, next])));
  }

  function setChapterOpen(n: number, open: boolean) {
    // Native toggles reach us through onToggle; keep the state in step with what the user did.
    setOpenByChapter((prev) => (prev[n] === open ? prev : { ...prev, [n]: open }));
  }

  return (
    <CollapsibleBox
      id={CHAPTERS_SECTION_ID}
      title={CHAPTERS_SECTION_TITLE}
      count={chapters.length}
      defaultOpen={false}
      actions={
        chapters.length > EXPAND_ALL_THRESHOLD ? (
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            {allOpen ? "Comprimi tutto" : "Espandi tutto"}
          </button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border/80">
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
              <div className="prose-book prose-book--compact pb-5 pl-10">
                {paragraphs(chapter.text).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </CollapsibleBox>
  );
}
