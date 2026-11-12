/**
 * Presentational part of the chat: the empty state with suggestions, and the
 * messages (text, tool chips, the model line under each assistant reply).
 * Has no hooks from `useChat`, so it can be tested with plain messages.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isToolUIPart, getToolName, type UIMessagePart, type UIDataTypes, type UITools } from "ai";
import { NotebookPen } from "lucide-react";
import { Badge } from "@ehub/ui/components/badge";
import { Button } from "@ehub/ui/components/button";
import { cn } from "@ehub/ui";
import type { ChatUIMessage } from "../shared/types";
import { ChatMarkdown } from "./markdown";
import type { SaveNote, SaveNoteInput } from "./notes";
import { markdownToPlainText } from "./plain-text";
import { describeToolCall } from "./tool-labels";

export const DEFAULT_SUGGESTIONS = [
  "Riassumi i punti principali",
  "Quali sono le idee più controverse?",
  "Quali domande lasceresti aperte?",
];

export type ChatMessagePart = UIMessagePart<UIDataTypes, UITools>;

export interface MessageListProps {
  messages: ChatUIMessage[];
  /** Shown while the reply is still streaming (keeps the list scrolled to the bottom). */
  streaming?: boolean;
  /** Renders assistant text. Defaults to `ChatMarkdown`. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Empty-state suggestions (clickable). */
  suggestions?: readonly string[];
  onSuggestion?: (text: string) => void;
  /** When given, each finished assistant reply offers "Salva come nota". */
  onSaveNote?: SaveNote;
}

export function MessageList({
  messages,
  streaming = false,
  renderMarkdown,
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestion,
  onSaveNote,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Replies saved as notes in this session (by message ID).
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Follow the conversation while it grows. Scroll the container, not the page.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-3 px-1 py-6">
        <p className="text-sm text-muted-foreground">
          Fai una domanda su questa fonte. Le risposte citano il punto da cui vengono.
        </p>
        <ul className="flex flex-col gap-2" aria-label="Suggerimenti">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => onSuggestion?.(suggestion)}
                className="w-full rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors outline-none hover:border-brand/40 hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label="Messaggi"
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 py-4"
    >
      {messages.map((message, index) => {
        const finished = !(streaming && index === messages.length - 1);
        const note = finished && onSaveNote ? noteFor(messages, index) : undefined;
        return (
          <MessageItem
            key={message.id}
            message={message}
            renderMarkdown={renderMarkdown}
            note={note}
            saved={savedIds.has(message.id)}
            onSave={
              note && onSaveNote
                ? () => {
                    const result = onSaveNote(note);
                    const markSaved = () => setSavedIds((current) => new Set(current).add(message.id));
                    if (isPromiseLike(result)) {
                      result.then(markSaved, (error: unknown) => console.error("Salvataggio della nota fallito", error));
                    } else {
                      markSaved();
                    }
                  }
                : undefined
            }
          />
        );
      })}
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
  const answerText = message.parts
    .flatMap((part) => (part.type === "text" && part.text.trim() !== "" ? [part.text] : []))
    .join("\n\n");
  const answer = markdownToPlainText(answerText);
  if (questionText === "" || answer === "") return undefined;
  const model = message.metadata?.model;
  return model ? { question: questionText, answer, model } : { question: questionText, answer };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function MessageItem({
  message,
  renderMarkdown,
  note,
  saved,
  onSave,
}: {
  message: ChatUIMessage;
  renderMarkdown?: (text: string) => ReactNode;
  /** The note this reply would become; `undefined` hides the save button. */
  note?: SaveNoteInput;
  saved: boolean;
  onSave?: () => void;
}) {
  if (message.role === "user") {
    const text = textOf(message.parts);
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
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
          return (
            <ToolChip
              key={key}
              name={getToolName(part)}
              input={part.input}
              state={part.state}
            />
          );
        }
        return null;
      })}
      <ReplyMeta metadata={message.metadata} />
      {note && onSave && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
            disabled={saved}
            onClick={onSave}
          >
            <NotebookPen aria-hidden /> {saved ? "Salvata" : "Salva come nota"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Model, provider, tier and token count under an assistant reply. */
export function ReplyMeta({ metadata }: { metadata: ChatUIMessage["metadata"] }) {
  if (!metadata) return null;
  const { model, provider, tier, totalTokens } = metadata;
  const downgraded = tier !== undefined && tier !== "smart";
  if (!model && !downgraded && totalTokens === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {model && (
        <span className="font-mono">
          {provider ? `${model} · ${provider}` : model}
        </span>
      )}
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

/** A tool call, shown as a small muted chip with a readable label (see `describeToolCall`). */
export function ToolChip({ name, input, state }: { name: string; input?: unknown; state: string }) {
  const status = toolStatus(state);
  return (
    <div
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground",
        status === "errore" && "border-destructive/40 text-destructive",
      )}
    >
      <span>{describeToolCall(name, input)}</span>
      <span className="font-medium">· {status}</span>
    </div>
  );
}

export function toolStatus(state: string): "in corso" | "fatto" | "errore" {
  if (state === "output-available") return "fatto";
  if (state === "output-error" || state === "output-denied") return "errore";
  return "in corso";
}

function textOf(parts: ChatMessagePart[]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
