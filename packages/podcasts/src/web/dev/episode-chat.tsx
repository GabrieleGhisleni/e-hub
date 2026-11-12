import { ChatButton } from "@ehub/chat/web";
import type { Episode, Show } from "@core/schema";
import { Markdown } from "@podcasts/components/lazy-markdown";
import { timestampVideoId } from "@podcasts/lib/timestamps";

const SUGGESTIONS = [
  "Riassumi l'episodio in cinque punti",
  "Quali affermazioni meriterebbero una verifica?",
  "In quali momenti si parla del tema principale?",
];

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
    />
  );
}
