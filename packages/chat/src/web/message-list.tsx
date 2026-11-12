/**
 * Presentational part of the chat: the empty state with suggestions, and the
 * messages (text, tool chips, the model line under each assistant reply).
 * Has no hooks from `useChat`, so it can be tested with plain messages.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { isToolUIPart, getToolName, type UIMessagePart, type UIDataTypes, type UITools } from "ai";
import { Badge } from "@ehub/ui/components/badge";
import { cn } from "@ehub/ui";
import type { ChatUIMessage } from "../shared/types";

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
  /** Renders assistant text as Markdown. Falls back to plain text. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Empty-state suggestions (clickable). */
  suggestions?: readonly string[];
  onSuggestion?: (text: string) => void;
}

export function MessageList({
  messages,
  streaming = false,
  renderMarkdown,
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestion,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} renderMarkdown={renderMarkdown} />
      ))}
    </div>
  );
}

function MessageItem({
  message,
  renderMarkdown,
}: {
  message: ChatUIMessage;
  renderMarkdown?: (text: string) => ReactNode;
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
            <div key={key} className="text-sm leading-relaxed">
              {renderMarkdown ? (
                renderMarkdown(part.text)
              ) : (
                <p className="whitespace-pre-wrap">{part.text}</p>
              )}
            </div>
          );
        }
        if (isToolUIPart(part)) {
          return <ToolChip key={key} name={getToolName(part)} state={part.state} />;
        }
        return null;
      })}
      <ReplyMeta metadata={message.metadata} />
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

/** A tool call, shown as a small muted chip. Works for any tool, named from its part. */
export function ToolChip({ name, state }: { name: string; state: string }) {
  const status = toolStatus(state);
  return (
    <div
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground",
        status === "errore" && "border-destructive/40 text-destructive",
      )}
    >
      <span>Strumento: {name}</span>
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
