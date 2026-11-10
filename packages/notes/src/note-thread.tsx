import { ArrowRightIcon, MessageSquareTextIcon, PinIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { SearchField, cn } from "@ehub/ui";
import { NoteCard, NoteEditor, noteAnchor } from "./note-card";
import { type NotesStore, notesStore, useItemNotes, useNotesMeta } from "./store";
import { NotesErrorBanner } from "./status";
import { matchesTokens, notesCount, searchTokens } from "./text";
import { type NoteItemRef, itemKey } from "./types";

/** Anchor of the thread section, for "Le mie note" links on the detail pages. */
export const NOTES_SECTION_ID = "le-mie-note";
export const NOTES_PATH = "/notes";

/** Above this many notes the thread offers a search field. */
const SEARCH_THRESHOLD = 5;

/** Scrolls to a note and highlights it for a moment. Also runs for `#nota-<id>` in the URL on arrival. */
export function useNoteFlash(ready: boolean) {
  const { hash } = useLocation();
  const [flashId, setFlashId] = useState<string | null>(null);

  const jumpTo = useCallback((id: string, focus = true) => {
    const el = document.getElementById(noteAnchor(id));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (focus) el.focus({ preventScroll: true });
    setFlashId(id);
  }, []);

  useEffect(() => {
    if (!ready || !hash.startsWith("#nota-")) return;
    // Wait a frame: the page above the thread may still be laying out.
    const frame = requestAnimationFrame(() => jumpTo(hash.slice("#nota-".length)));
    return () => cancelAnimationFrame(frame);
  }, [ready, hash, jumpTo]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

  return { flashId, jumpTo };
}

/**
 * The personal notes of one book or episode, as a conversation with yourself: oldest first, the composer at the
 * bottom. Pinned notes are also listed in a strip at the top; clicking one jumps to it in the thread.
 */
export function NoteThread({
  item,
  noun,
  className,
  store = notesStore,
}: {
  item: NoteItemRef;
  /** "questo libro" / "questo episodio". */
  noun: string;
  className?: string;
  store?: NotesStore;
}) {
  const notes = useItemNotes(item, store);
  const meta = useNotesMeta(store);
  const [query, setQuery] = useState("");
  const [pinNext, setPinNext] = useState(false);
  const headingId = useId();
  const tokens = useMemo(() => searchTokens(query), [query]);
  const visible = useMemo(
    () => notes.filter((note) => matchesTokens(tokens, note.body)),
    [notes, tokens],
  );
  const pinned = notes.filter((note) => note.pinned);
  const { flashId, jumpTo } = useNoteFlash(notes.length > 0);

  // Published site: nothing to show for an item without notes.
  if (meta.readOnly && notes.length === 0) return null;

  return (
    <section
      id={NOTES_SECTION_ID}
      aria-labelledby={headingId}
      data-module="notes"
      className={cn("scroll-mt-24", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2
            id={headingId}
            className="flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-balance"
          >
            <MessageSquareTextIcon aria-hidden className="size-5 text-brand" />
            Le mie note
            {notes.length > 0 ? (
              <span className="font-sans text-base font-normal text-muted-foreground tabular-nums">
                ({notes.length})
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {meta.readOnly
              ? `Pensieri, citazioni e domande su ${noun}.`
              : `Pensieri, citazioni e domande su ${noun}. Fissa quelle da ritrovare.`}
          </p>
        </div>
        <Link
          to={`${NOTES_PATH}?item=${encodeURIComponent(itemKey(item))}`}
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          Apri in Note
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>

      <NotesErrorBanner store={store} className="mt-5" />

      {pinned.length > 0 ? (
        <div className="mt-5 rounded-xl border border-brand/25 bg-brand-soft/50 p-3 sm:p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-brand uppercase">
            <PinIcon aria-hidden className="size-3 fill-current" />
            Fissate
          </p>
          <ul className="flex flex-col gap-1">
            {pinned.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    // After clearing the search the note is rendered again; jump on the next frame.
                    requestAnimationFrame(() => jumpTo(note.id));
                  }}
                  className="line-clamp-2 w-full rounded-md px-2 py-1 text-left text-sm text-foreground/90 outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {note.body}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.length > SEARCH_THRESHOLD ? (
        <div className="mt-5">
          <SearchField
            value={query}
            onChange={setQuery}
            label={`Cerca nelle note su ${noun}`}
            placeholder={`Cerca tra ${notesCount(notes.length)}`}
            className="max-w-md"
          />
          {tokens.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              {visible.length === 0
                ? "Nessuna nota trovata."
                : `${notesCount(visible.length)} su ${notes.length}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ol className="mt-5 flex flex-col gap-3" aria-label="Note">
          {visible.map((note) => (
            <li key={note.id}>
              <NoteCard
                note={note}
                tokens={tokens}
                flash={flashId === note.id}
                readOnly={meta.readOnly}
                store={store}
              />
            </li>
          ))}
        </ol>
      ) : meta.status === "loading" ? (
        <div
          className="mt-5 h-20 animate-pulse rounded-xl bg-muted"
          aria-label="Caricamento delle note"
        />
      ) : notes.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
          Ancora nessuna nota. Scrivi la prima qui sotto: resta collegata a {noun}.
        </p>
      ) : null}

      {meta.readOnly ? null : (
        <div className="mt-4">
          <NoteEditor
            restore={meta.rejectedDraft?.itemKey === itemKey(item) ? meta.rejectedDraft : undefined}
            label={`Nuova nota su ${noun}`}
            placeholder="Scrivi una nota…"
            submitLabel="Aggiungi nota"
            onSubmit={(body) => {
              const note = store.add(item, body, { pinned: pinNext });
              setPinNext(false);
              setQuery("");
              // Keep typing in the composer: scroll and highlight only.
              requestAnimationFrame(() => jumpTo(note.id, false));
            }}
            extra={
              <button
                type="button"
                aria-pressed={pinNext}
                onClick={() => setPinNext((v) => !v)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  pinNext
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <PinIcon aria-hidden className={cn("size-3.5", pinNext && "fill-current")} />
                Fissa
              </button>
            }
          />
        </div>
      )}
    </section>
  );
}

/** Small "N note" link for detail-page headers; jumps to the thread. Renders nothing without notes. */
export function NotesJumpLink({
  item,
  store = notesStore,
}: {
  item: NoteItemRef;
  store?: NotesStore;
}) {
  const notes = useItemNotes(item, store);
  const meta = useNotesMeta(store);
  const pinned = notes.filter((n) => n.pinned).length;
  if (meta.readOnly && notes.length === 0) return null;
  return (
    <a
      href={`#${NOTES_SECTION_ID}`}
      data-module="notes"
      onClick={(event) => {
        event.preventDefault();
        const section = document.getElementById(NOTES_SECTION_ID);
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
        section?.querySelector("textarea")?.focus({ preventScroll: true });
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3.5 text-sm font-medium text-brand outline-none transition-colors hover:border-brand/60 focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <MessageSquareTextIcon aria-hidden className="size-4" />
      {notes.length === 0 ? "Aggiungi una nota" : notesCount(notes.length)}
      {pinned > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-xs font-normal opacity-80">
          · <PinIcon aria-hidden className="size-3 fill-current" />
          {pinned}
        </span>
      ) : null}
    </a>
  );
}

/**
 * "3 note" pill for list items (book covers, episode rows). Renders nothing when the item has no notes.
 * `overlay` sits on a cover image; `inline` follows text.
 */
export function NoteCountBadge({
  module,
  id,
  variant = "inline",
  className,
}: {
  module: NoteItemRef["module"];
  id: string;
  variant?: "inline" | "overlay";
  className?: string;
}) {
  const notes = useItemNotes({ module, id });
  if (notes.length === 0) return null;
  const pinned = notes.some((n) => n.pinned);
  return (
    <span
      data-module="notes"
      title={notesCount(notes.length) + (pinned ? ", con note fissate" : "")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full text-xs font-medium whitespace-nowrap tabular-nums",
        variant === "overlay"
          ? "bg-background/90 px-2 py-0.5 text-foreground shadow-sm backdrop-blur-sm"
          : "bg-brand-soft px-2 py-0.5 text-brand",
        className,
      )}
    >
      {pinned ? (
        <PinIcon aria-hidden className="size-3 fill-current text-brand" />
      ) : (
        <MessageSquareTextIcon aria-hidden className="size-3 text-brand" />
      )}
      {notesCount(notes.length)}
    </span>
  );
}
