import { Suspense } from "react";
import type { RouteObject } from "react-router";
import { DevNewExplorationPage } from "./dev-slots.tsx";
import { ExplorationPage } from "./exploration-page.tsx";
import { ExplorationListPage } from "./exploration-list-page.tsx";
import { exploreStore } from "./store.ts";

export { ExplorationBadges } from "./exploration-badges.tsx";
export { ExplorationListPage } from "./exploration-list-page.tsx";
export { ExplorationPage } from "./exploration-page.tsx";
export {
  ExploreApiError,
  type ExploreMeta,
  type ExploreStore,
  type ExplorationPatch,
  type LibraryBookRef,
  type NewExplorationInput,
  type VerdictInput,
  createHttpExploreStore,
  createMemoryExploreStore,
  createStaticExploreStore,
  exploreStore,
  explorationsOfBook,
  isExploration,
  setExploreStore,
  useExploration,
  useExploreMeta,
  useExplorations,
} from "./store.ts";
export { formatVerdict, VERDICT_LABELS } from "../labels.ts";

/**
 * The explorations module's routes, spread into the shell's router. `explore/new` exists only in the dev server
 * (the static build has no write UI, so the path falls through to the detail page's "not found").
 */
export function exploreRoutes(): RouteObject[] {
  return [
    { path: "explore", element: <ExplorationListPage /> },
    ...(DevNewExplorationPage
      ? [
          {
            path: "explore/new",
            element: (
              <Suspense fallback={null}>
                <DevNewExplorationPage store={exploreStore} />
              </Suspense>
            ),
          },
        ]
      : []),
    { path: "explore/:id", element: <ExplorationPage /> },
  ];
}
