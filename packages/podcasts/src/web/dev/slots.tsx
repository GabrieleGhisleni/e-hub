/**
 * Local-only features (DESIGN.md §8.5). Loaded only in dev by
 * `src/web/dev-slot.tsx`; never part of the production bundle.
 *
 * Contract: export `slots` (a component per slot name, see `DevSlotPropsMap`)
 * and keep `DEV_ONLY_MARKER` (the bundle check greps `dist/` for it). The real
 * components live in sibling files (Fast Refresh); this file only maps names.
 */
import type { DevSlots } from "../dev-slot";
import { AddEpisodeButton } from "./add-episode";
import { AddConversation } from "./conversation-dialog";
import { DevLayout } from "./dev-layout";
import { EpisodeChat } from "./episode-chat";
import { EpisodeTools } from "./episode-tools";
import { NoTranscriptBadge } from "./transcript-status";

export const DEV_ONLY_MARKER = "e-podcasts-dev-only";

export const slots: DevSlots = {
  "header-actions": () => <AddEpisodeButton />,
  layout: DevLayout,
  "home-empty": () => (
    <div className="mt-4">
      <AddEpisodeButton variant="default" />
    </div>
  ),
  "episode-actions": ({ episode }) => <EpisodeTools episode={episode} />,
  "episode-chat": ({ episode, show }) => <EpisodeChat episode={episode} show={show} />,
  "episode-transcript": ({ episode, children }) =>
    episode.transcriptSource ? children : <NoTranscriptBadge episode={episode} />,
  "episode-conversations": ({ episode }) => <AddConversation episode={episode} />,
};
