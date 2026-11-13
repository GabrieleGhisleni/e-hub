/**
 * The draft of notes mode: the replies picked with "Aggiungi alla bozza" (or written by the model with `save_note`),
 * in order. Each entry can be edited, moved or removed; "Salva come nota" saves the whole draft as one note and
 * empties it. Beside the conversation in the expanded panel, in place of it in the docked one.
 */
import { ArrowDown, ArrowUp, Check, NotebookPen, Pencil, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@ehub/ui/components/button";
import { cn } from "@ehub/ui";
import { ChatMarkdown } from "./markdown";
import { type DraftEntry, draftNoteText, moveEntry } from "./notes-draft";

export function DraftPanel({
  entries,
  onChange,
  onSave,
  onClose,
  saveLabel = "Salva come nota",
  className,
}: {
  entries: readonly DraftEntry[];
  onChange: (entries: DraftEntry[]) => void;
  /** Saves the draft as one note; the panel empties the draft when it resolves. */
  onSave: (text: string) => void | Promise<void>;
  /** Docked panel: back to the conversation. */
  onClose?: () => void;
  /** Label of the save button. */
  saveLabel?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    const text = draftNoteText(entries);
    if (text === "") return;
    setStatus("saving");
    try {
      await onSave(text);
      onChange([]);
      setEditing(null);
      setStatus("saved");
    } catch (error) {
      console.error("Salvataggio della bozza fallito", error);
      setStatus("error");
    }
  };

  const commitEdit = (id: string) => {
    const text = editText.trim();
    onChange(
      text === "" ? entries.filter((e) => e.id !== id) : entries.map((e) => (e.id === id ? { ...e, text } : e)),
    );
    setEditing(null);
  };

  return (
    <aside aria-label="Bozza degli appunti" className={cn("flex min-h-0 flex-col bg-muted/30", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <NotebookPen aria-hidden className="size-4 text-brand" />
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          Bozza appunti <span className="font-normal text-muted-foreground tabular-nums">· {entries.length}</span>
        </h3>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClose}>
            Torna alla chat
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <p className="py-6 text-sm leading-relaxed text-muted-foreground">
            {status === "saved"
              ? "Bozza salvata nelle note del libro."
              : "Le risposte che aggiungi con «Aggiungi alla bozza» finiscono qui. Le rivedi, le correggi e le salvi come una nota sola."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <li key={entry.id} className="group/entry rounded-xl border bg-card px-3.5 py-3">
                {editing === entry.id ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`draft-${entry.id}`} className="sr-only">
                      Modifica il paragrafo
                    </label>
                    <textarea
                      id={`draft-${entry.id}`}
                      autoFocus
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditing(null);
                        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          commitEdit(entry.id);
                        }
                      }}
                      className="min-h-32 w-full resize-y rounded-md border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/30 [field-sizing:content]"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(null)}>
                        Annulla
                      </Button>
                      <Button size="sm" className="h-7 text-xs" onClick={() => commitEdit(entry.id)}>
                        Fatto
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <ChatMarkdown>{entry.text}</ChatMarkdown>
                    <div className="mt-2 flex items-center gap-0.5 text-muted-foreground">
                      <EntryAction
                        label="Sposta su"
                        disabled={index === 0}
                        onClick={() => onChange(moveEntry(entries, index, -1))}
                      >
                        <ArrowUp />
                      </EntryAction>
                      <EntryAction
                        label="Sposta giù"
                        disabled={index === entries.length - 1}
                        onClick={() => onChange(moveEntry(entries, index, 1))}
                      >
                        <ArrowDown />
                      </EntryAction>
                      <EntryAction
                        label="Modifica"
                        onClick={() => {
                          setEditText(entry.text);
                          setEditing(entry.id);
                        }}
                      >
                        <Pencil />
                      </EntryAction>
                      <EntryAction
                        label="Togli dalla bozza"
                        className="ml-auto hover:text-destructive"
                        onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}
                      >
                        <X />
                      </EntryAction>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {confirmClear ? (
          <div role="group" aria-label="Conferma svuotamento" className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Svuotare la bozza?</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
              No
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onChange([]);
                setConfirmClear(false);
              }}
            >
              Svuota
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={entries.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 aria-hidden /> Svuota
          </Button>
        )}
        {status === "error" && <span className="text-xs text-destructive">Nota non salvata, riprova.</span>}
        <Button
          size="sm"
          className="ml-auto h-8"
          disabled={entries.length === 0 || status === "saving"}
          onClick={() => void save()}
        >
          {status === "saved" && entries.length === 0 ? <Check aria-hidden /> : <NotebookPen aria-hidden />}
          {saveLabel}
        </Button>
      </div>
    </aside>
  );
}

function EntryAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5",
        className,
      )}
    >
      {children}
    </button>
  );
}
