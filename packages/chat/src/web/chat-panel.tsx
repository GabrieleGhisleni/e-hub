/**
 * Chat panel: a right-side sheet that talks to `POST /api/chat` about one
 * source (a book, an episode, an exploration). State lives in memory only;
 * history persistence is a later phase.
 */
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquareText, Plus, RotateCcw, Send, Square } from "lucide-react";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ehub/ui/components/sheet";
import { Textarea } from "@ehub/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@ehub/ui/components/tooltip";
import { CHAT_API_PATH, type ChatSource, type ChatUIMessage } from "../shared/types";
import { MessageList } from "./message-list";

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export function ChatPanel({
  source,
  title,
  subtitle,
  renderMarkdown,
  suggestions,
  notice,
  open,
  onOpenChange,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState(newConversationId);
  const [draft, setDraft] = useState("");

  // Recreated only when the source changes; the body is exactly `{ id, messages, source }`.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: CHAT_API_PATH,
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages, source },
        }),
      }),
    [source.kind, source.id],
  );

  const { messages, sendMessage, status, stop, regenerate, error } = useChat<ChatUIMessage>({
    id: conversationId,
    transport,
  });

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "" || busy) return;
    void sendMessage({ text: trimmed });
  };

  const submit = () => {
    send(draft);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const newConversation = () => {
    void stop();
    setDraft("");
    setConversationId(newConversationId());
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="font-serif text-xl">Chatta con l'AI</SheetTitle>
          <SheetDescription className="truncate">
            {subtitle ? `${title} · ${subtitle}` : title}
          </SheetDescription>
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={newConversation}>
              <Plus aria-hidden /> Nuova conversazione
            </Button>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4">
          {notice && <div className="pt-4 text-xs text-muted-foreground">{notice}</div>}
          <MessageList
            messages={messages}
            streaming={busy}
            renderMarkdown={renderMarkdown}
            suggestions={suggestions}
            onSuggestion={send}
          />
        </div>

        {error && (
          <div className="px-4 pb-2">
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

        <form
          className="flex items-end gap-2 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) submit();
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Scrivi una domanda"
            aria-label="Messaggio"
            rows={2}
            className="max-h-40 min-h-10 resize-none"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => void stop()}>
              <Square aria-hidden /> Stop
            </Button>
          ) : (
            <Button type="submit" disabled={draft.trim() === ""}>
              <Send aria-hidden /> Invia
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}

export interface ChatButtonProps extends Omit<ChatPanelProps, "open" | "onOpenChange"> {
  /** Disables the button; `disabledReason` shows as a tooltip. */
  disabled?: boolean;
  disabledReason?: string;
}

/** "Chatta" button that owns the open state and renders the panel. */
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
      <Button variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <MessageSquareText aria-hidden /> Chatta
      </Button>
      <ChatPanel {...panel} open={open} onOpenChange={setOpen} />
    </>
  );
}
