import { useCallback, useState } from "react";
import { ChevronRight, MessagesSquare, RotateCcw } from "lucide-react";
import type { Conversation, Episode } from "@core/schema";
import { Markdown } from "@podcasts/components/lazy-markdown";
import { Button } from "@ehub/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ehub/ui/components/collapsible";
import { Skeleton } from "@ehub/ui/components/skeleton";
import { DevSlot } from "@podcasts/dev-slot";
import { formatConversationDate, plural } from "@podcasts/lib/format";
import { useSiteData } from "@podcasts/site-data";

type LoadState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; conversations: Conversation[] };

/**
 * Conversations with the agent (DESIGN.md §8.4): collapsed by default; the
 * episode's conversations chunk is fetched the first time the section opens.
 * Without a conversations file the section is hidden (in dev it stays, for
 * the "add conversation" slot).
 */
export function ConversationsSection({
  episode,
  timestampVideoId,
}: {
  episode: Episode;
  timestampVideoId: string | undefined;
}) {
  const { conversations: source } = useSiteData();
  const available = source.has(episode.slug);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    source.load(episode.slug).then(
      (conversations) => setState({ status: "ready", conversations }),
      (error: unknown) => {
        console.error(`cannot load the conversations of ${episode.slug}`, error);
        setState({ status: "error" });
      },
    );
  }, [source, episode.slug]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // First opening: fetch the chunk.
    if (next && state.status === "idle") load();
  };

  if (!available && !import.meta.env.DEV) return null;
  const conversations = state.status === "ready" ? state.conversations : undefined;

  return (
    <section aria-labelledby="conversations-heading" className="mt-12 border-t pt-8 sm:mt-14">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="conversations-heading"
            className="font-serif text-2xl font-semibold tracking-tight text-balance"
          >
            {available ? (
              <CollapsibleTrigger className="group -mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors outline-none hover:bg-muted/50 hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <ChevronRight
                  className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                  aria-hidden
                />
                Conversazioni
                {conversations && (
                  <span className="font-sans text-base font-normal text-muted-foreground tabular-nums">
                    ({conversations.length})
                  </span>
                )}
              </CollapsibleTrigger>
            ) : (
              "Conversazioni"
            )}
          </h2>
          <DevSlot name="episode-conversations" episode={episode} conversations={conversations} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {available
            ? open
              ? conversations &&
                `${plural(conversations.length, "chat", "chat")} con un agente su questo episodio.`
              : "Le chat con un agente su questo episodio, così come sono state incollate."
            : "Nessuna conversazione salvata."}
        </p>
        {available && (
          <CollapsibleContent className="mt-6 space-y-6">
            {state.status === "ready" ? (
              state.conversations.map((conversation, index) => (
                <ConversationItem
                  key={`${conversation.date}-${index}`}
                  conversation={conversation}
                  timestampVideoId={timestampVideoId}
                />
              ))
            ) : state.status === "error" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <span>Non è stato possibile caricare le conversazioni.</span>
                <Button variant="outline" size="sm" onClick={load}>
                  <RotateCcw aria-hidden /> Riprova
                </Button>
              </div>
            ) : (
              <div
                className="space-y-3 rounded-xl border p-5"
                aria-busy="true"
                aria-label="Caricamento delle conversazioni"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </CollapsibleContent>
        )}
      </Collapsible>
    </section>
  );
}

function ConversationItem({
  conversation,
  timestampVideoId,
}: {
  conversation: Conversation;
  timestampVideoId: string | undefined;
}) {
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
          {conversation.agent}
        </span>
        <time dateTime={conversation.date} className="text-brand">
          {formatConversationDate(conversation.date)}
        </time>
      </header>
      <Markdown timestampVideoId={timestampVideoId} className="px-4 py-4 sm:px-6 sm:py-5">
        {conversation.markdown}
      </Markdown>
    </article>
  );
}
