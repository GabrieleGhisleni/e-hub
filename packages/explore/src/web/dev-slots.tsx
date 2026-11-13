/*
 * Local-only parts of the explorations UI. Each one is a lazy import behind `import.meta.env.DEV`, so the static
 * build never includes the write controls, the chat or the proposal card (the build has no reference to them).
 * Pages render these only when `devTools` is on (the default in the dev server).
 */
import { lazy } from "react";

export const DevExplorationToolbar = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/dev-tools.tsx").then((m) => ({ default: m.ExplorationDevToolbar })),
    )
  : null;

export const DevSourceActions = import.meta.env.DEV
  ? lazy(() => import("./dev/dev-tools.tsx").then((m) => ({ default: m.SourceDevActions })))
  : null;

export const DevNoteComposer = import.meta.env.DEV
  ? lazy(() => import("./dev/dev-tools.tsx").then((m) => ({ default: m.NoteDevComposer })))
  : null;

export const DevNoteDelete = import.meta.env.DEV
  ? lazy(() => import("./dev/dev-tools.tsx").then((m) => ({ default: m.NoteDevDelete })))
  : null;

export const DevExplorationNewLink = import.meta.env.DEV
  ? lazy(() => import("./dev/dev-tools.tsx").then((m) => ({ default: m.NewExplorationLink })))
  : null;

export const DevNewExplorationPage = import.meta.env.DEV
  ? lazy(() => import("./dev/dev-tools.tsx").then((m) => ({ default: m.NewExplorationPage })))
  : null;
