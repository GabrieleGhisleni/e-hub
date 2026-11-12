import { ChatButton, chatNoteBody } from "@ehub/chat/web";
import { type NoteItemRef, notesStore } from "@ehub/notes";
import type { Episode, Show } from "@core/schema";
import { toast } from "sonner";
import { Markdown } from "@podcasts/components/lazy-markdown";
import { episodePath } from "@podcasts/lib/paths";
import { timestampVideoId } from "@podcasts/lib/timestamps";

const SUGGESTIONS = [
  "Riassumi l'episodio in cinque punti",
  "Quali affermazioni meriterebbero una verifica?",
  "In quali momenti si parla del tema principale?",
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
      source={{ kind: "episode", id: episode.slug }}
      title={episode.title}
      subtitle={show?.name ?? episode.show}
      renderMarkdown={(text) => <Markdown timestampVideoId={videoId}>{text}</Markdown>}
      suggestions={SUGGESTIONS}
      disabled={!hasTranscript}
      disabledReason="Serve la trascrizione"
      onSaveNote={(note) => {
        notesStore.add(episodeNoteItem(episode, show), chatNoteBody(note));
        toast.success("Nota salvata");
      }}
    />
  );
}
