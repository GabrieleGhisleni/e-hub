/**
 * Chat panel: a right-side sheet that talks to `POST /api/chat` about one
 * source (a book, an episode, an exploration). The conversation is saved to
 * localStorage per source when a reply finishes (see `history.ts`), and the
 * most recent one is restored when the panel opens.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { History, MessageSquareText, Plus, RotateCcw, Send, Square, Trash2 } from "lucide-react";
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
import { type SaveNote } from "./notes";
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
  /** When given, finished replies offer "Salva come nota" and the caller stores the note. */
  onSaveNote?: SaveNote;
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

export function ChatPanel({
  source,
  title,
  subtitle,
  renderMarkdown,
  suggestions,
  notice,
  onSaveNote,
  open,
  onOpenChange,
}: ChatPanelProps) {
  // The conversation shown: its ID (also the chat's ID) and the messages it starts with.
  const [session, setSession] = useState<Session>(() => ({ id: newConversationId(), messages: [] }));
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<StoredConversation[]>([]);
  const restoredRef = useRef(false);

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
    id: session.id,
    messages: session.messages,
    transport,
  });

  const busy = status === "submitted" || status === "streaming";

  // First time the panel opens: restore the most recent saved conversation.
  useEffect(() => {
    if (!open || restoredRef.current) return;
    restoredRef.current = true;
    const [latest] = loadConversations(source);
    if (latest) setSession({ id: latest.id, messages: latest.messages });
  }, [open, source]);

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
    if (!busy) saveConversation(source, { id: session.id, messages });
    void stop();
    setDraft("");
    setSession({ id: newConversationId(), messages: [] });
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="font-serif text-xl">Chatta con l'AI</SheetTitle>
          <SheetDescription className="truncate">
            {subtitle ? `${title} · ${subtitle}` : title}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Button variant="ghost" size="sm" onClick={newConversation}>
              <Plus aria-hidden /> Nuova conversazione
            </Button>
            <DropdownMenu
              onOpenChange={(next) => {
                if (next) setHistory(loadConversations(source));
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <History aria-hidden /> Conversazioni
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Conversazioni salvate</DropdownMenuLabel>
                {history.length === 0 ? (
                  <DropdownMenuItem disabled>Nessuna conversazione salvata</DropdownMenuItem>
                ) : (
                  history.map((conversation) => (
                    <DropdownMenuItem
                      key={conversation.id}
                      disabled={busy}
                      onSelect={() => openConversation(conversation)}
                      className="gap-3"
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
            onSaveNote={onSaveNote}
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
