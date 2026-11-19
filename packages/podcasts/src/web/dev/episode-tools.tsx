import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Episode } from "@core/schema";
import { Button } from "@ehub/ui/components/button";
import { DeleteEpisode } from "./delete-episode";
import { EpisodeEditorDialog, hasPendingDraft } from "./episode-editor";

/** Local-only actions in the episode header: edit and remove. */
export function EpisodeTools({ episode }: { episode: Episode }) {
  // A draft left by a reload reopens the editor straight away.
  const [editing, setEditing] = useState(() => hasPendingDraft(episode));
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label="Modifica episodio"
        title="Modifica episodio"
        aria-haspopup="dialog"
        onClick={() => setEditing(true)}
      >
        <Pencil aria-hidden />
      </Button>
      <DeleteEpisode episode={episode} />
      <EpisodeEditorDialog episode={episode} open={editing} onOpenChange={setEditing} />
    </>
  );
}
