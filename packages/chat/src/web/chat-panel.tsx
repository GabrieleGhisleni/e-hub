/**
 * Chat panel: a window docked to the right that talks to `POST /api/chat` about one source (a book, an episode, an
 * exploration). It does not block the page: it can be resized from its left edge (the width is remembered),
 * expanded to a large centered window, and closed with the X or Esc. On small screens it fills the screen.
 *
 * The conversation is saved to localStorage per source when a reply finishes (see `history.ts`), and the most recent
 * one is restored when the panel opens. The model can save notes itself with the client-side `save_note` tool,
 * handled here through `onSaveNote` (see `notes.ts`).
 *
 * Two toggles sit in the composer. "Appunti" (notes mode, remembered per source): the server asks for replies that read
 * as notes, and replies are picked into a draft (`DraftPanel`, `notes-draft.ts`) saved later as one note. "Feel rich":
 * the request goes to the rich model (`EHUB_AI_RICH_MODEL`); it is not remembered.
 */
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import {
  ArrowUp,
  Gem,
  History,
  Info,
  Maximize2,
  MessageSquareText,
  Minimize2,
  NotebookPen,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ehub/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ehub/ui/components/tooltip";
import { cn } from "@ehub/ui";
import { CHAT_API_PATH, type ChatSource, type ChatUIMessage } from "../shared/types";
import { MessageList, type RenderToolPart } from "./message-list";
import { DraftPanel } from "./draft-panel";
import {
  NOTE_DRAFTED_OUTPUT,
  type NoteLabels,
  type SaveNote,
  handleSaveNoteToolCall,
  resolveNoteLabels,
} from "./notes";
import {
  type DraftEntry,
  loadDraft,
  loadNotesMode,
  newDraftEntry,
  saveDraft,
  saveNotesMode,
} from "./notes-draft";
import {
  deleteConversation,
  loadConversations,
  relativeDate,
  saveConversation,
  type StoredConversation,
} from "./history";

export interface ChatPanelProps {
  source: ChatSource;
  /** Name of the source, shown under the heading (e.g. the episode title). */
  title: string;
  subtitle?: string;
  /** Renders assistant text (e.g. with clickable timestamps). Defaults to `ChatMarkdown`. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Empty-state suggestions. */
  suggestions?: readonly string[];
  /** Small note shown above the messages (e.g. a hint about how the answers are produced). */
  notice?: ReactNode;
  /**
   * When given, finished replies offer "Salva come nota", and the model can save notes itself ("aggiungilo alle
   * note"). The caller stores the note.
   */
  onSaveNote?: SaveNote;
  /** Labels of the save buttons and of the answer to `save_note`, when the notes go somewhere else. See `NoteLabels`. */
  noteLabels?: NoteLabels;
  /** Custom view for a tool call (e.g. proposed verdicts) that replaces its chip. See `RenderToolPart`. */
  renderToolPart?: RenderToolPart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Session = { id: string; messages: ChatUIMessage[] };

export function newConversationId(): string {
  return crypto.randomUUID();
}

/** The server answers errors with JSON `{ error: string }`. Shows that text when there is one. */
export function describeChatError(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string" &&
      parsed.error !== ""
    ) {
      return parsed.error;
    }
  } catch {
    // Not JSON: the message is the text.
  }
  return error.message || "Errore inatteso.";
}

// ---------------------------------------------------------------------------------------------
// Width of the docked panel (remembered per browser)
// ---------------------------------------------------------------------------------------------

export const CHAT_WIDTH_STORAGE_KEY = "ehub-chat-width";
export const CHAT_DEFAULT_WIDTH = 480;
export const CHAT_MIN_WIDTH = 360;
/** Largest docked width, as a share of the window. */
const CHAT_MAX_SHARE = 0.8;
const KEYBOARD_STEP = 32;

/** Keeps a width between the minimum and 80% of the window (never below the minimum). */
export function clampChatWidth(width: number, viewport: number): number {
  const max = Math.max(CHAT_MIN_WIDTH, Math.floor(viewport * CHAT_MAX_SHARE));
  return Math.round(Math.min(max, Math.max(CHAT_MIN_WIDTH, width)));
}

function readStoredWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : CHAT_DEFAULT_WIDTH;
  } catch {
    return CHAT_DEFAULT_WIDTH;
  }
}

function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Storage blocked: the width is not remembered.
  }
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

// ---------------------------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------------------------

export function ChatPanel({
  source,
  title,
  subtitle,
  renderMarkdown,
  suggestions,
  notice,
  onSaveNote,
  noteLabels,
  renderToolPart,
  open,
  onOpenChange,
}: ChatPanelProps) {
  const headingId = useId();
  const labels = resolveNoteLabels(noteLabels);
  const descriptionId = useId();

  // The conversation shown: its ID (also the chat's ID) and the messages it starts with.
  const [session, setSession] = useState<Session>(() => ({ id: newConversationId(), messages: [] }));
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<StoredConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => clampChatWidth(readStoredWidth(), viewportWidth()));
  const [resizing, setResizing] = useState(false);
  const restoredRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Notes mode and its draft (per source, from localStorage), and "Feel rich" (per panel, not remembered).
  const canTakeNotes = onSaveNote !== undefined;
  const [notesMode, setNotesMode] = useState(false);
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);
  const [draftOpen, setDraftOpen] = useState(false);
  const [rich, setRich] = useState(false);
  useEffect(() => {
    setNotesMode(loadNotesMode(source));
    setDraftEntries(loadDraft(source));
    setDraftOpen(false);
  }, [source.kind, source.id]);
  const notesOn = canTakeNotes && notesMode;

  const updateDraft = useCallback(
    (update: (current: DraftEntry[]) => DraftEntry[]) => {
      setDraftEntries((current) => {
        const next = update(current);
        saveDraft(source, next);
        return next;
      });
    },
    [source.kind, source.id],
  );
  const toggleNotesMode = () => {
    const next = !notesMode;
    setNotesMode(next);
    saveNotesMode(source, next);
    if (!next) setDraftOpen(false);
  };
  const draftedIds = useMemo(
    () => new Set(draftEntries.flatMap((entry) => (entry.messageId ? [entry.messageId] : []))),
    [draftEntries],
  );

  // Read at send time, so the transport is not rebuilt when a toggle changes.
  const requestFlagsRef = useRef({ notesMode: false, rich: false });
  requestFlagsRef.current = { notesMode: notesOn, rich };

  // Recreated only when the source changes; the body is `{ id, messages, source }` plus the toggles that are on.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: CHAT_API_PATH,
        prepareSendMessagesRequest: ({ id, messages }) => {
          const flags = requestFlagsRef.current;
          return {
            body: {
              id,
              messages,
              source,
              ...(flags.notesMode ? { notesMode: true } : {}),
              ...(flags.rich ? { rich: true } : {}),
            },
          };
        },
      }),
    [source.kind, source.id],
  );

  // The tool handler runs outside React's render: it reads the latest callback and messages through refs.
  const onSaveNoteRef = useRef(onSaveNote);
  onSaveNoteRef.current = onSaveNote;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const messagesRef = useRef<ChatUIMessage[]>([]);

  const { messages, sendMessage, status, stop, regenerate, error, addToolOutput } = useChat<ChatUIMessage>({
    id: session.id,
    messages: session.messages,
    transport,
    // After the browser answers a client-side tool (save_note), the model continues and confirms.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
      // In notes mode the model's notes go into the draft, which the user reviews before saving.
      const drafting = onSaveNoteRef.current !== undefined && requestFlagsRef.current.notesMode;
      void handleSaveNoteToolCall({
        toolCall,
        onSaveNote: drafting
          ? ({ answer }) => updateDraft((current) => [...current, newDraftEntry(answer)])
          : onSaveNoteRef.current,
        successOutput: drafting ? NOTE_DRAFTED_OUTPUT : labelsRef.current.savedOutput,
        model: lastAssistant?.metadata?.model,
        addToolOutput: (result) => addToolOutput(result as Parameters<typeof addToolOutput>[0]),
      });
    },
  });
  messagesRef.current = messages;

  const busy = status === "submitted" || status === "streaming";

  // First time the panel opens: restore the most recent saved conversation.
  useEffect(() => {
    if (!open || restoredRef.current) return;
    restoredRef.current = true;
    const [latest] = loadConversations(source);
    if (latest) setSession({ id: latest.id, messages: latest.messages });
  }, [open, source]);

  // Focus the composer on open; give the focus back to whatever opened the panel on close.
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const frame = requestAnimationFrame(() => textareaRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
    return undefined;
  }, [open]);

  // Keep the docked width inside the window when the window shrinks.
  useEffect(() => {
    if (!open) return;
    const onResize = () => setWidth((current) => clampChatWidth(current, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // Save when a reply finishes. The ID check skips a chat that was just replaced
  // (its last reply is then not saved, the previous state stays in history).
  const sessionIdRef = useRef(session.id);
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const sameConversation = sessionIdRef.current === session.id;
    sessionIdRef.current = session.id;
    if (wasBusyRef.current && !busy && sameConversation) {
      saveConversation(source, { id: session.id, messages });
    }
    wasBusyRef.current = busy;
  }, [busy, messages, session.id, source]);

  // Grow the composer with its text, up to its max height.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || busy) return;
    setDraftOpen(false);
    void sendMessage({ text: trimmed });
  };

  const submit = () => {
    send(draft);
    setDraft("");
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Esc first closes an open menu (Radix handles it), then the panel.
    if (event.key === "Escape" && !historyOpen && !event.defaultPrevented) {
      event.stopPropagation();
      close();
    }
  };

  const newConversation = () => {
    if (!busy) saveConversation(source, { id: session.id, messages });
    void stop();
    setDraft("");
    setSession({ id: newConversationId(), messages: [] });
    textareaRef.current?.focus();
  };

  const openConversation = (conversation: StoredConversation) => {
    if (busy) return;
    setDraft("");
    setSession({ id: conversation.id, messages: conversation.messages });
  };

  const deleteCurrent = () => {
    void stop();
    deleteConversation(source, session.id);
    setDraft("");
    setSession({ id: newConversationId(), messages: [] });
  };

  // Drag the left edge to resize the docked panel.
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setResizing(true);
    const onMove = (move: PointerEvent) => {
      setWidth(clampChatWidth(window.innerWidth - move.clientX, window.innerWidth));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizing(false);
      setWidth((current) => {
        storeWidth(current);
        return current;
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const resizeBy = (delta: number) => {
    setWidth((current) => {
      const next = clampChatWidth(current + delta, window.innerWidth);
      storeWidth(next);
      return next;
    });
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") resizeBy(KEYBOARD_STEP);
    else if (event.key === "ArrowRight") resizeBy(-KEYBOARD_STEP);
    else return;
    event.preventDefault();
  };

  const resetWidth = () => {
    const next = clampChatWidth(CHAT_DEFAULT_WIDTH, window.innerWidth);
    setWidth(next);
    storeWidth(next);
  };

  if (!open) return null;

  const sourceLine = subtitle ? `${title} · ${subtitle}` : title;

  return (
    <TooltipProvider delayDuration={300}>
      {expanded && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-[2px] animate-in fade-in-0"
          onClick={() => setExpanded(false)}
        />
      )}
      <section
        role="dialog"
        aria-modal={expanded}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onKeyDown={onPanelKeyDown}
        style={expanded ? undefined : { width }}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-background text-foreground",
          // Phones: always full screen.
          "max-sm:inset-0 max-sm:!w-full",
          expanded && (notesOn ? "sm:max-w-7xl" : "sm:max-w-5xl"),
          expanded
            ? "sm:inset-4 sm:mx-auto sm:rounded-2xl sm:border sm:shadow-2xl animate-in fade-in-0 zoom-in-95"
            : "sm:inset-y-0 sm:right-0 sm:border-l sm:shadow-2xl animate-in slide-in-from-right duration-300",
          resizing && "select-none",
        )}
      >
        {!expanded && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ridimensiona la chat"
            aria-valuenow={width}
            aria-valuemin={CHAT_MIN_WIDTH}
            tabIndex={0}
            onPointerDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
            onDoubleClick={resetWidth}
            title="Trascina per ridimensionare · doppio clic per la larghezza iniziale"
            className="group absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize outline-none sm:block"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors",
                "group-hover:bg-brand/50 group-focus-visible:bg-brand",
                resizing && "bg-brand",
              )}
            />
          </div>
        )}

        <header className="flex items-center gap-3 border-b px-4 py-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
          >
            <Sparkles className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="font-serif text-lg leading-tight">
              Chatta con l'AI
            </h2>
            <p id={descriptionId} className="truncate text-xs text-muted-foreground" title={sourceLine}>
              {sourceLine}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Nuova conversazione" onClick={newConversation}>
              <Plus />
            </IconButton>
            <DropdownMenu
              open={historyOpen}
              onOpenChange={(next) => {
                setHistoryOpen(next);
                if (next) setHistory(loadConversations(source));
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Conversazioni">
                      <History />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Conversazioni</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="z-[60] w-80">
                <DropdownMenuLabel>Conversazioni salvate</DropdownMenuLabel>
                {history.length === 0 ? (
                  <DropdownMenuItem disabled>Nessuna conversazione salvata</DropdownMenuItem>
                ) : (
                  history.map((conversation) => (
                    <DropdownMenuItem
                      key={conversation.id}
                      disabled={busy}
                      onSelect={() => openConversation(conversation)}
                      className={cn("gap-3", conversation.id === session.id && "bg-accent/60")}
                    >
                      <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeDate(conversation.updatedAt)}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={busy} onSelect={deleteCurrent}>
                  <Trash2 aria-hidden /> Elimina questa conversazione
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              label={expanded ? "Riduci" : "Ingrandisci"}
              onClick={() => setExpanded((value) => !value)}
              className="max-sm:hidden"
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
            <IconButton label="Chiudi (Esc)" onClick={close}>
              <X />
            </IconButton>
          </div>
        </header>

        {notice && (
          <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-px size-3.5 shrink-0" />
            <div className="min-w-0">{notice}</div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {notesOn && !expanded && draftOpen ? (
          <DraftPanel
            className="flex-1"
            entries={draftEntries}
            onChange={(entries) => updateDraft(() => entries)}
            onSave={(text) => onSaveNote?.({ answer: text })}
            onClose={() => setDraftOpen(false)}
            saveLabel={labels.save}
          />
        ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            streaming={busy}
            waiting={status === "submitted"}
            renderMarkdown={renderMarkdown}
            suggestions={suggestions}
            onSuggestion={send}
            onSaveNote={onSaveNote}
            noteLabels={labels}
            renderToolPart={renderToolPart}
            emptyTitle={title}
            className={cn("px-4", expanded && "sm:px-8")}
            contentClassName={expanded ? "mx-auto w-full max-w-3xl" : undefined}
            textSize={expanded ? "large" : "default"}
            {...(notesOn
              ? {
                  draftedIds,
                  onAddToDraft: ({ messageId, text }: { messageId: string; text: string }) =>
                    updateDraft((current) => [...current, newDraftEntry(text, messageId)]),
                }
              : {})}
          />
        </div>
        )}

        {error && (
          <div className={cn("px-4 pb-2", expanded && "mx-auto w-full max-w-3xl")}>
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{describeChatError(error)}</span>
                <Button variant="outline" size="sm" onClick={() => void regenerate()}>
                  <RotateCcw aria-hidden /> Riprova
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {notesOn && !expanded && !draftOpen && (
          <div className="px-4 pt-1">
            <button
              type="button"
              onClick={() => setDraftOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg border border-brand/25 bg-brand-soft/50 px-3 py-1.5 text-left text-xs text-brand outline-none hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <NotebookPen aria-hidden className="size-3.5" />
              <span className="flex-1 font-medium">Bozza appunti · {draftEntries.length}</span>
              <span className="text-muted-foreground">Rivedi e salva</span>
            </button>
          </div>
        )}

        <form
          className={cn("px-4 pt-2 pb-4", expanded && "mx-auto w-full max-w-3xl")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) submit();
          }}
        >
          <div
            className={cn(
              "flex flex-col rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow]",
              "focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15",
            )}
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={onSaveNote ? labels.placeholder : "Fai una domanda"}
              aria-label="Messaggio"
              rows={1}
              className={cn(
                "max-h-48 min-h-11 w-full resize-none bg-transparent px-4 pt-3 pb-1 outline-none placeholder:text-muted-foreground",
                expanded ? "text-base" : "text-sm",
              )}
            />
            <div className="flex items-center justify-between gap-2 pr-2 pb-2 pl-4">
              <div className="flex min-w-0 items-center gap-1.5">
                {canTakeNotes && (
                  <ComposerToggle
                    label="Appunti"
                    hint="Modalità appunti: risposte scritte come note, da aggiungere a una bozza che poi salvi"
                    pressed={notesOn}
                    onClick={toggleNotesMode}
                    className={notesOn ? "border-brand/40 bg-brand-soft text-brand" : undefined}
                  >
                    <NotebookPen />
                  </ComposerToggle>
                )}
                <ComposerToggle
                  label="Feel rich"
                  hint="Feel rich: risponde il modello più potente (GPT-6-luna) invece di quello di sempre"
                  pressed={rich}
                  onClick={() => setRich((value) => !value)}
                  className={
                    rich
                      ? "border-amber-500/40 bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                      : undefined
                  }
                >
                  <Gem />
                </ComposerToggle>
                {expanded && (
                  <span className="truncate text-[0.7rem] text-muted-foreground max-md:hidden">
                    <kbd className="font-sans">Invio</kbd> per inviare · <kbd className="font-sans">Maiusc+Invio</kbd> a capo
                  </span>
                )}
              </div>
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="ml-auto size-8 rounded-full"
                  onClick={() => void stop()}
                  aria-label="Ferma"
                  title="Ferma"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="ml-auto size-8 rounded-full"
                  disabled={draft.trim() === ""}
                  aria-label="Invia"
                  title="Invia"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </form>
        </div>
        {notesOn && expanded && (
          <DraftPanel
            className="w-[24rem] shrink-0 border-l max-sm:hidden"
            entries={draftEntries}
            onChange={(entries) => updateDraft(() => entries)}
            onSave={(text) => onSaveNote?.({ answer: text })}
            saveLabel={labels.save}
          />
        )}
        </div>
      </section>
    </TooltipProvider>
  );
}

/** A pill toggle in the composer (notes mode, Feel rich): icon + label, `aria-pressed`, tooltip with what it does. */
function ComposerToggle({
  label,
  hint,
  pressed,
  onClick,
  className,
  children,
}: {
  label: string;
  hint: string;
  pressed: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-3.5",
            className,
          )}
        >
          {children}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8 text-muted-foreground hover:text-foreground", className)}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface ChatButtonProps extends Omit<ChatPanelProps, "open" | "onOpenChange"> {
  /** Disables the button; `disabledReason` shows as a tooltip. */
  disabled?: boolean;
  disabledReason?: string;
}

/** "Chatta" button that owns the open state and renders the panel. Clicking it again closes the panel. */
export function ChatButton({ disabled = false, disabledReason, ...panel }: ChatButtonProps) {
  const [open, setOpen] = useState(false);

  if (disabled) {
    const button = (
      <Button variant="outline" disabled>
        <MessageSquareText aria-hidden /> Chatta
      </Button>
    );
    if (!disabledReason) return button;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={0}>
              {button}
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <Button
        variant={open ? "secondary" : "outline"}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MessageSquareText aria-hidden /> Chatta
      </Button>
      <ChatPanel {...panel} open={open} onOpenChange={setOpen} />
    </>
  );
}
