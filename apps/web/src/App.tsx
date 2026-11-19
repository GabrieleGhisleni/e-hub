import { createBrowserRouter, RouterProvider } from "react-router";
import { BookCover, ZlibrarySearchSlot, libraryRoutes, useSiteIndex } from "@ehub/library/web";
import { podcastsRoutes } from "@ehub/podcasts/web";
import type { BookSource } from "@ehub/explore/schema";
import { exploreRoutes } from "@ehub/explore";
import { notesRoutes } from "@ehub/notes";
import { Shell } from "./components/shell";
import { HomePage } from "./pages/home";
import { SettingsPage } from "./pages/settings";
import { NotFoundPage } from "./pages/not-found";

function ExplorationBookCover({
  source,
  explorationId,
  privateCover,
}: {
  source: BookSource;
  explorationId: string;
  privateCover: boolean;
}) {
  if (source.origin === "library") return <LibraryExplorationCover source={source} />;
  const coverUrl = privateCover
    ? `/api/explore/${encodeURIComponent(explorationId)}/books/${encodeURIComponent(source.id)}/cover`
    : null;
  return <BookCover book={{ ...source, coverUrl }} className="w-full" />;
}

function LibraryExplorationCover({ source }: { source: BookSource }) {
  const { data } = useSiteIndex();
  const book = data?.books.find(({ id }) => id === source.id);
  return <BookCover book={{ ...source, coverUrl: book?.coverUrl ?? null }} className="w-full" />;
}

/** One SPA, one router: the modules contribute their own routes ("library/…", "podcasts/…") under the shell. */
const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Shell />,
      children: [
        { index: true, element: <HomePage /> },
        ...libraryRoutes(),
        ...podcastsRoutes(),
        ...notesRoutes(),
        ...exploreRoutes({ cover: ExplorationBookCover, zlibrary: ZlibrarySearchSlot }),
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
  // Synchronous navigations (no transitions): the podcasts search box is driven by the URL.
  return <RouterProvider router={router} useTransitions={false} />;
}
