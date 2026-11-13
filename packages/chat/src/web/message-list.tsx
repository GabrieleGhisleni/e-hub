/**
 * Presentational part of the chat: the empty state with suggestions, and the
 * messages (text, tool chips, the notes the model saved, the model line and the
 * actions under each assistant reply). Has no hooks from `useChat`, so it can be
 * tested with plain messages.
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isToolUIPart, getToolName, type UIMessagePart, type UIDataTypes, type UITools } from "ai";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  List,
  ListPlus,
  LoaderCircle,
  NotebookPen,
  Scale,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@ehub/ui/components/badge";
import { Button } from "@ehub/ui/components/button";
import { cn } from "@ehub/ui";
import { SAVE_NOTE_TOOL, type ChatUIMessage } from "../shared/types";
import { ChatMarkdown, type ChatTextSize, ChatTextSizeContext, useChatTextSize } from "./markdown";
import { NOTE_DRAFTED_OUTPUT, NOTE_SAVED_OUTPUT, type SaveNote, type SaveNoteInput } from "./notes";
import { markdownToPlainText } from "./plain-text";
import { describeToolCall } from "./tool-labels";

export const DEFAULT_SUGGESTIONS = [
  "Riassumi i punti principali",
  "Quali sono le idee più controverse?",
  "Quali domande lasceresti aperte?",
];

export type ChatMessagePart = UIMessagePart<UIDataTypes, UITools>;

/** What a tool part gives to `renderToolPart`: its name, call ID, state and input/output as the model saw them. */
export type ToolPartInfo = {
  toolName: string;
  toolCallId: string;
  state: string;
  input: unknown;
  output: unknown;
};

/**
 * Replaces the chip of a tool call with a custom view (e.g. the verdicts proposed by a tool). Returning `undefined`
 * keeps the chip.
 */
export type RenderToolPart = (part: ToolPartInfo) => ReactNode | undefined;

export interface MessageListProps {
  messages: ChatUIMessage[];
  /** Shown while the reply is still streaming (keeps the list scrolled to the bottom). */
  streaming?: boolean;
  /** The request is sent and nothing has come back yet: shows a "thinking" line. */
  waiting?: boolean;
  /** Renders assistant text. Defaults to `ChatMarkdown`. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Empty-state suggestions (clickable). */
  suggestions?: readonly string[];
  onSuggestion?: (text: string) => void;
  /** When given, each finished assistant reply offers "Salva come nota". */
  onSaveNote?: SaveNote;
  /** Custom view for a tool call; when it returns something, it replaces the chip. */
  renderToolPart?: RenderToolPart;
  /** Name of the source, used in the empty state ("Chiedi qualcosa su …"). */
  emptyTitle?: string;
  /** Classes of the scrolling container (e.g. horizontal padding). */
  className?: string;
  /** Classes of the column inside it (e.g. a max width when the panel is expanded). */
  contentClassName?: string;
  /** "large" in the expanded panel: bigger, easier to read text. */
  textSize?: ChatTextSize;
  /**
   * Notes mode: each finished reply offers "Aggiungi alla bozza" (in place of "Salva come nota"), which hands its
   * Markdown to the caller. `draftedIds` are the replies already in the draft.
   */
  onAddToDraft?: (reply: { messageId: string; text: string }) => void;
  draftedIds?: ReadonlySet<string>;
}

/** Distance from the bottom (px) under which the list keeps following new text. */
const STICK_THRESHOLD = 80;

export function MessageList({
  messages,
  streaming = false,
  waiting = false,
  renderMarkdown,
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestion,
  onSaveNote,
  renderToolPart,
  emptyTitle,
  className,
  contentClassName,
  textSize = "default",
  onAddToDraft,
  draftedIds,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Replies saved as notes in this session (by message ID).
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Follow the conversation while it grows, unless the user scrolled up to read. Scroll the container, not the page.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [messages, streaming, waiting]);

  // A new question always brings the view back to the bottom.
  const lastRole = messages.at(-1)?.role;
  useEffect(() => {
    if (lastRole === "user") {
      stickRef.current = true;
      setShowJump(false);
    }
  }, [lastRole, messages.length]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickRef.current = distance < STICK_THRESHOLD;
    setShowJump(distance >= STICK_THRESHOLD);
  };

  const jumpToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    setShowJump(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  if (messages.length === 0) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}>
        <div className={cn("my-auto flex flex-col gap-5 py-8", contentClassName)}>
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"
            >
              <Sparkles className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-serif text-lg">
                {emptyTitle ? (
                  <>
                    Chiedi qualcosa su <span className="italic">{emptyTitle}</span>
                  </>
                ) : (
                  "Chiedi qualcosa su questa fonte"
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                Fai una domanda su questa fonte. Le risposte citano il punto da cui vengono.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-2" aria-label="Suggerimenti">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => onSuggestion?.(suggestion)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm",
                    "transition-colors outline-none hover:border-brand/40 hover:bg-brand-soft/40",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  )}
                >
                  <span className="min-w-0 flex-1">{suggestion}</span>
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const last = messages.at(-1);
  const thinking = waiting || (streaming && last?.role === "user");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Messaggi"
        className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto py-5", className)}
      >
        <ChatTextSizeContext.Provider value={textSize}>
        <div className={cn("flex flex-col", textSize === "large" ? "gap-8" : "gap-6", contentClassName)}>
          {messages.map((message, index) => {
            const finished = !(streaming && index === messages.length - 1);
            // In notes mode replies go to the draft instead of straight into the notes.
            const note = finished && onSaveNote && !onAddToDraft ? noteFor(messages, index) : undefined;
            return (
              <MessageItem
                key={message.id}
                message={message}
                finished={finished}
                active={streaming && !waiting && index === messages.length - 1 && message.role === "assistant"}
                renderMarkdown={renderMarkdown}
                renderToolPart={renderToolPart}
                note={note}
                drafted={draftedIds?.has(message.id) ?? false}
                onAddToDraft={
                  finished && onAddToDraft && message.role === "assistant"
                    ? (text: string) => onAddToDraft({ messageId: message.id, text })
                    : undefined
                }
                saved={savedIds.has(message.id)}
                onSave={
                  note && onSaveNote
                    ? () => {
                        const result = onSaveNote(note);
                        const markSaved = () => setSavedIds((current) => new Set(current).add(message.id));
                        if (isPromiseLike(result)) {
                          result.then(markSaved, (error: unknown) =>
                            console.error("Salvataggio della nota fallito", error),
                          );
                        } else {
                          markSaved();
                        }
                      }
                    : undefined
                }
              />
            );
          })}
          {thinking && <ThinkingLine />}
        </div>
        </ChatTextSizeContext.Provider>
      </div>
      {showJump && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={jumpToBottom}
          aria-label="Vai in fondo"
          className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full bg-background shadow-md animate-in fade-in-0"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}

/**
 * The note for an assistant reply: the question is the closest user message before it, the answer
 * is its text parts as plain text. `undefined` when either one is missing.
 */
export function noteFor(messages: readonly ChatUIMessage[], index: number): SaveNoteInput | undefined {
  const message = messages[index];
  if (!message || message.role !== "assistant") return undefined;
  const question = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
  if (!question) return undefined;
  const questionText = textOf(question.parts).trim();
  // The note keeps the Markdown of the reply (bold, lists, chapter references): the notes render it.
  const answer = answerTextOf(message).trim();
  if (questionText === "" || answer === "") return undefined;
  const model = message.metadata?.model;
  return model ? { question: questionText, answer, model } : { question: questionText, answer };
}

function answerTextOf(message: ChatUIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" && part.text.trim() !== "" ? [part.text] : []))
    .join("\n\n");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/** Three dots bouncing in turn: the loader of the chat. */
function LoaderDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-brand/70"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  );
}

/** Loader with a label ("Sta pensando…", "Legge il capitolo 4…"), announced to screen readers. */
export function ActivityLine({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 text-sm text-muted-foreground">
      <LoaderDots />
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

/** While the reply has not started: the avatar and "Sta pensando…". */
function ThinkingLine() {
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="pt-1.5">
        <ActivityLine label="Sta pensando…" />
      </div>
    </div>
  );
}

/**
 * What the model is doing while a reply streams, from its last part: reasoning, a tool still running, writing, or
 * thinking between steps (after a tool result, before the next text).
 */
export function activityOf(message: ChatUIMessage): string {
  const last = [...message.parts].reverse().find((part) => part.type !== "step-start");
  if (!last) return "Sta pensando…";
  if (last.type === "reasoning") return "Sta ragionando…";
  if (last.type === "text") return last.text.trim() === "" ? "Sta pensando…" : "Sta scrivendo…";
  if (isToolUIPart(last) && toolStatus(last.state) === "in corso") {
    return `${describeToolCall(getToolName(last), last.input)}…`;
  }
  return "Sta pensando…";
}

function MessageItem({
  message,
  finished,
  active = false,
  renderMarkdown,
  renderToolPart,
  note,
  saved,
  onSave,
  drafted = false,
  onAddToDraft,
}: {
  message: ChatUIMessage;
  finished: boolean;
  /** The reply is streaming right now: shows what the model is doing under it. */
  active?: boolean;
  renderMarkdown?: (text: string) => ReactNode;
  renderToolPart?: RenderToolPart;
  /** The note this reply would become; `undefined` hides the save button. */
  note?: SaveNoteInput;
  saved: boolean;
  onSave?: () => void;
  /** Notes mode: the reply is already in the draft. */
  drafted?: boolean;
  /** Notes mode: adds the reply's Markdown to the draft. */
  onAddToDraft?: (text: string) => void;
}) {
  const large = useChatTextSize() === "large";
  if (message.role === "user") {
    const text = textOf(message.parts);
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 whitespace-pre-wrap",
            large ? "text-[1.0625rem] leading-[1.7]" : "text-sm leading-relaxed",
          )}
        >
          {text}
        </div>
      </div>
    );
  }

  const answer = answerTextOf(message);

  return (
    <div className="group/reply flex gap-3">
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`;
          if (part.type === "text") {
            if (part.text === "") return null;
            return (
              <div key={key}>
                {renderMarkdown ? renderMarkdown(part.text) : <ChatMarkdown>{part.text}</ChatMarkdown>}
              </div>
            );
          }
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            const custom = renderToolPart?.({
              toolName: name,
              toolCallId: part.toolCallId,
              state: part.state,
              input: part.input,
              output: part.output,
            });
            if (custom !== undefined) return <div key={key}>{custom}</div>;
            if (name === SAVE_NOTE_TOOL) {
              return <SavedNoteCard key={key} input={part.input} output={part.output} state={part.state} />;
            }
            return (
              <ToolChip
                key={key}
                name={name}
                input={part.input}
                state={part.state}
                output={part.output}
                errorText={part.errorText}
              />
            );
          }
          return null;
        })}
        {active && <ActivityLine label={activityOf(message)} />}
        {finished && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {answer.trim() !== "" && <CopyButton text={markdownToPlainText(answer)} />}
            {note && onSave && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={saved}
                onClick={onSave}
              >
                {saved ? <Check aria-hidden /> : <NotebookPen aria-hidden />} {saved ? "Salvata" : "Salva come nota"}
              </Button>
            )}
            {onAddToDraft && answer.trim() !== "" && (
              <Button
                variant={drafted ? "ghost" : "outline"}
                size="sm"
                className={cn("h-7 px-2.5 text-xs", drafted ? "text-muted-foreground" : "border-brand/40 text-brand hover:bg-brand-soft hover:text-brand")}
                disabled={drafted}
                onClick={() => onAddToDraft(answer.trim())}
              >
                {drafted ? <Check aria-hidden /> : <ListPlus aria-hidden />} {drafted ? "Nella bozza" : "Aggiungi alla bozza"}
              </Button>
            )}
            <div className="ml-auto">
              <ReplyMeta metadata={message.metadata} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copiata" : "Copia"}
    </Button>
  );
}

/** Model, provider, tier and token count under an assistant reply. */
export function ReplyMeta({ metadata }: { metadata: ChatUIMessage["metadata"] }) {
  if (!metadata) return null;
  const { model, provider, tier, totalTokens } = metadata;
  const downgraded = tier !== undefined && tier !== "smart";
  if (!model && !downgraded && totalTokens === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted-foreground/80">
      {model && <span className="font-mono">{provider ? `${model} · ${provider}` : model}</span>}
      {downgraded && (
        <Badge variant="destructive" className="h-5 text-[0.7rem]">
          declassato a {tier}
        </Badge>
      )}
      {totalTokens !== undefined && (
        <span className="tabular-nums">{totalTokens.toLocaleString("it-IT")} token</span>
      )}
    </div>
  );
}

function toolIcon(name: string) {
  switch (name) {
    case "read_chapter":
      return BookOpen;
    case "search_book":
      return Search;
    case "list_chapters":
      return List;
    case "propose_verdicts":
      return Scale;
    case SAVE_NOTE_TOOL:
      return NotebookPen;
    default:
      return Wrench;
  }
}

/** Text of a tool output: strings as they are, anything else as indented JSON. */
export function formatToolOutput(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/**
 * A tool call: a small chip with an icon, a readable label (see `describeToolCall`) and its state. When the tool
 * answered, a click opens its output (what the model read).
 */
export function ToolChip({
  name,
  input,
  state,
  output,
  errorText,
}: {
  name: string;
  input?: unknown;
  state: string;
  output?: unknown;
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const status = toolStatus(state);
  const Icon = toolIcon(name);
  const detail = status === "errore" ? (errorText ?? formatToolOutput(output)) : formatToolOutput(output);
  const expandable = status !== "in corso" && detail.trim() !== "";
  const label = describeToolCall(name, input);

  const content = (
    <>
      {status === "in corso" ? (
        <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin" />
      ) : status === "errore" ? (
        <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <Icon aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-medium">· {status}</span>
      {expandable && (
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      )}
    </>
  );
  const chipClass = cn(
    "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground",
    status === "errore" && "border-destructive/40 bg-destructive/5 text-destructive",
  );

  if (!expandable) return <div className={chipClass}>{content}</div>;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Nascondi il risultato" : "Mostra il risultato"}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          chipClass,
          "cursor-pointer transition-colors outline-none hover:border-brand/40 hover:text-foreground",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {content}
      </button>
      {open && (
        <div
          className={cn(
            "max-h-72 overflow-auto rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground animate-in fade-in-0",
            status === "errore" && "border-destructive/30 text-destructive",
          )}
          aria-label={`Risultato: ${label}`}
          role="region"
        >
          {detail}
        </div>
      )}
    </div>
  );
}

/** The note the model saved with `save_note`: its text, and whether it was saved. */
function SavedNoteCard({ input, output, state }: { input: unknown; output: unknown; state: string }) {
  const text =
    input !== null && typeof input === "object" && "text" in input && typeof input.text === "string"
      ? input.text
      : "";
  const result = typeof output === "string" ? output : "";
  const pending = state !== "output-available" && state !== "output-error";
  const drafted = result === NOTE_DRAFTED_OUTPUT;
  const failed = state === "output-error" || (result !== "" && result !== NOTE_SAVED_OUTPUT && !drafted);
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5",
        failed ? "border-destructive/40 bg-destructive/5" : "border-brand/25 bg-brand-soft/40",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          failed ? "text-destructive" : "text-brand",
        )}
      >
        {pending ? (
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        ) : failed ? (
          <CircleAlert aria-hidden className="size-3.5" />
        ) : (
          <NotebookPen aria-hidden className="size-3.5" />
        )}
        {pending ? "Salvo la nota…" : failed ? result || "Nota non salvata" : drafted ? "Aggiunta alla bozza" : "Nota salvata"}
      </div>
      {text !== "" && <ChatMarkdown>{text}</ChatMarkdown>}
    </div>
  );
}

export function toolStatus(state: string): "in corso" | "fatto" | "errore" {
  if (state === "output-available") return "fatto";
  if (state === "output-error" || state === "output-denied") return "errore";
  return "in corso";
}

function textOf(parts: ChatMessagePart[]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}
