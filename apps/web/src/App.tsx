import { createBrowserRouter, RouterProvider } from "react-router";
import { libraryRoutes } from "@ehub/library/web";
import { podcastsRoutes } from "@ehub/podcasts/web";
import { exploreRoutes } from "@ehub/explore";
import { notesRoutes } from "@ehub/notes";
import { Shell } from "./components/shell";
import { HomePage } from "./pages/home";
import { SettingsPage } from "./pages/settings";
import { NotFoundPage } from "./pages/not-found";

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
        ...exploreRoutes(),
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
