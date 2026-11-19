import { ChatButton, chatNoteBody, type ToolPartInfo } from "@ehub/chat/web";
import { type NoteItemRef, notesStore } from "@ehub/notes";
import { PROPOSE_EPISODE_EDIT_TOOL } from "@core/chat-edit";
import type { Episode, Show } from "@core/schema";
import { toast } from "sonner";
import { Markdown } from "@podcasts/components/lazy-markdown";
import { episodePath } from "@podcasts/lib/paths";
import { timestampVideoId } from "@podcasts/lib/timestamps";
import { EpisodeEditCard } from "./episode-edit-card";

const SUGGESTIONS = [
  "Riassumi l'episodio in cinque punti",
  "Quali affermazioni meriterebbero una verifica?",
  "In quali momenti si parla del tema principale?",
  "Cosa ho scritto finora su questo episodio?",
];

/** The note item for this episode, the same shape the episode page builds for its notes. */
export function episodeNoteItem(episode: Episode, show: Show | undefined): NoteItemRef {
  return {
    module: "podcasts",
    id: episode.slug,
    title: episode.title,
    subtitle: show?.name ?? episode.show,
    href: episodePath(episode.slug),
  };
}

/** "Chatta" on an episode: the chat about its transcript (dev only, see `dev/slots.tsx`). */
export function EpisodeChat({ episode, show }: { episode: Episode; show: Show | undefined }) {
  const videoId = timestampVideoId(episode);
  const hasTranscript = episode.transcriptSource !== undefined;
  return (
    <ChatButton
      iconOnly
      source={{ kind: "episode", id: episode.slug }}
      title={episode.title}
      subtitle={show?.name ?? episode.show}
      renderMarkdown={(text) => <Markdown timestampVideoId={videoId}>{text}</Markdown>}
      suggestions={SUGGESTIONS}
      disabled={!hasTranscript}
      disabledReason="Serve la trascrizione"
      renderToolPart={(part: ToolPartInfo) =>
        part.toolName === PROPOSE_EPISODE_EDIT_TOOL ? (
          <EpisodeEditCard key={part.toolCallId} episode={episode} part={part} />
        ) : undefined
      }
      onSaveNote={(note) => {
        notesStore.add(episodeNoteItem(episode, show), chatNoteBody(note));
        toast.success("Nota salvata");
      }}
    />
  );
}
