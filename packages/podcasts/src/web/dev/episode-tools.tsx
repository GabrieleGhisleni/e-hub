import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Episode } from "@core/schema";
import { Button } from "@ehub/ui/components/button";
import { CopyForAgent } from "./copy-for-agent";
import { DeleteEpisode } from "./delete-episode";
import { EpisodeEditorDialog, hasPendingDraft } from "./episode-editor";
import { SpeakersDialog } from "./speakers-dialog";

/** Local-only actions in the episode header: edit, copy for the agent, fix speakers, remove. */
export function EpisodeTools({ episode }: { episode: Episode }) {
  // A draft left by a reload reopens the editor straight away.
  const [editing, setEditing] = useState(() => hasPendingDraft(episode));
  const hasTranscript = episode.transcriptSource !== undefined;
  return (
    <>
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil aria-hidden /> Modifica
      </Button>
      {hasTranscript && <CopyForAgent episode={episode} />}
      {hasTranscript && <SpeakersDialog episode={episode} />}
      <DeleteEpisode episode={episode} />
      <EpisodeEditorDialog episode={episode} open={editing} onOpenChange={setEditing} />
    </>
  );
}
