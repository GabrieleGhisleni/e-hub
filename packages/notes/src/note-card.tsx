import {
  BookOpenIcon,
  HeadphonesIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { type NotesStore, notesStore } from "./store";
import { NoteText, formatNoteDate } from "./text";
import { type Note, type NoteModule, MODULE_LABELS } from "./types";

export const MODULE_ICONS: Readonly<Record<NoteModule, typeof BookOpenIcon>> = {
  library: BookOpenIcon,
  podcasts: HeadphonesIcon,
};

/** DOM id of a note, so links (`#nota-<id>`) and the pinned strip can jump to it. */
export const noteAnchor = (id: string) => `nota-${id}`;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const SUBMIT_HINT = isMac ? "⌘ Invio" : "Ctrl+Invio";

/**
 * Multiline note input: grows with its content, Ctrl/⌘+Enter submits, Escape cancels (when `onCancel` is given).
 */
export function NoteEditor({
  initial = "",
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
  autoFocus,
  extra,
  label,
  restore,
}: {
  /** Puts this text back in the (empty) field, e.g. a note the server refused. Keyed by `at`. */
  restore?: { body: string; at: number };
  initial?: string;
  submitLabel: string;
  placeholder: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Controls left of the buttons (e.g. "Fissa"). */
  extra?: ReactNode;
  label: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const empty = text.trim() === "";

  useEffect(() => {
    if (!restore) return;
    setText((current) => (current.trim() === "" ? restore.body : current));
    ref.current?.focus();
    // `restore` is a stable object from the store snapshot: this runs once per refused note.
  }, [restore]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const submit = () => {
    if (empty) return;
    onSubmit(text);
    setText("");
  };

  return (
    <form
      className="rounded-xl border border-input bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        value={text}
        rows={2}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
        className="block max-h-[50vh] min-h-[4.5rem] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[0.9375rem] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2.5">
        <div className="flex items-center gap-1">{extra}</div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">{SUBMIT_HINT}</span>
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Annulla
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={empty}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function IconAction({
  label,
  onClick,
  children,
  pressed,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * One note: body, date, and actions (pin, edit, delete with confirmation). With `showItem` it also names the book
 * or episode it belongs to (notes page).
 */
export function NoteCard({
  note,
  tokens,
  showItem = false,
  flash = false,
  readOnly = false,
  store = notesStore,
}: {
  note: Note;
  tokens?: readonly string[];
  showItem?: boolean;
  /** Briefly highlight (after a jump from the pinned strip or a link). */
  flash?: boolean;
  /** Published site: no pin/edit/delete. */
  readOnly?: boolean;
  store?: NotesStore;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const Icon = MODULE_ICONS[note.item.module];
  const edited = note.updatedAt !== note.createdAt;

  return (
    <article
      id={noteAnchor(note.id)}
      tabIndex={-1}
      aria-label={`Nota del ${formatNoteDate(note.createdAt)}`}
      className={cn(
        "group/note relative scroll-mt-28 rounded-xl border bg-card px-4 pt-3 pb-2 outline-none transition-[border-color,box-shadow,background-color] duration-500 sm:px-5",
        note.pinned ? "border-brand/35" : "border-border",
        flash && "bg-brand-soft/60 ring-3 ring-brand/30",
      )}
    >
      {showItem ? (
        <Link
          to={`${note.item.href}#${noteAnchor(note.id)}`}
          className="mb-2 flex min-w-0 items-center gap-2 rounded-md text-sm outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <span
            data-module={note.item.module}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand"
            title={MODULE_LABELS[note.item.module]}
          >
            <Icon aria-hidden className="size-3.5" />
          </span>
          <span className="min-w-0 truncate font-medium">{note.item.title}</span>
          {note.item.subtitle ? (
            <span className="hidden min-w-0 shrink truncate text-muted-foreground sm:inline">
              · {note.item.subtitle}
            </span>
          ) : null}
        </Link>
      ) : null}

      {mode === "edit" ? (
        <div className="pb-1.5">
          <NoteEditor
            initial={note.body}
            autoFocus
            label="Modifica la nota"
            placeholder="Testo della nota"
            submitLabel="Salva"
            onSubmit={(body) => {
              store.update(note.id, { body });
              setMode("view");
            }}
            onCancel={() => setMode("view")}
          />
        </div>
      ) : (
        <div className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap text-foreground">
          <NoteText text={note.body} tokens={tokens} />
        </div>
      )}

      <footer className="mt-1.5 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {note.pinned ? (
            <span className="inline-flex items-center gap-1 font-medium text-brand">
              <PinIcon aria-hidden className="size-3 fill-current" />
              Fissata
            </span>
          ) : null}
          <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
          {edited ? <span title={formatNoteDate(note.updatedAt)}>· modificata</span> : null}
        </p>

        {mode === "confirm-delete" ? (
          <div
            className="flex items-center gap-2 text-sm"
            role="group"
            aria-label="Conferma eliminazione"
          >
            <span className="text-muted-foreground">Eliminare la nota?</span>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")} autoFocus>
              Annulla
            </Button>
            <Button size="sm" variant="destructive" onClick={() => store.remove(note.id)}>
              Elimina
            </Button>
          </div>
        ) : mode === "view" && !readOnly ? (
          <div className="-mr-2 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/note:opacity-100 sm:group-hover/note:opacity-100">
            <IconAction
              label={note.pinned ? "Togli dalle fissate" : "Fissa la nota"}
              pressed={note.pinned}
              onClick={() => store.update(note.id, { pinned: !note.pinned })}
              className={note.pinned ? "text-brand" : undefined}
            >
              {note.pinned ? <PinOffIcon /> : <PinIcon />}
            </IconAction>
            <IconAction label="Modifica" onClick={() => setMode("edit")}>
              <PencilIcon />
            </IconAction>
            <IconAction
              label="Elimina"
              onClick={() => setMode("confirm-delete")}
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon />
            </IconAction>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
