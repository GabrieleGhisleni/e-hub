/**
 * Feature-module entry, mounted by the shell under `PODCASTS_BASE`.
 *
 * The shell owns the document: global header/footer, `<main id="main">` and
 * the router (and its basename). This module contributes one route subtree.
 */
import type { RouteObject } from "react-router";
import { ModuleLayout } from "@podcasts/components/site-layout";
import { EpisodeRoute } from "@podcasts/pages/episode";
import { HomePage } from "@podcasts/pages/home";
import { NotFoundPage } from "@podcasts/pages/not-found";
import { siteData } from "@podcasts/data";
import { SiteDataProvider, type SiteData } from "@podcasts/site-data";

export { PODCASTS_BASE } from "@podcasts/lib/paths";

function PodcastsLayout({ data }: { data: SiteData }) {
  return (
    <SiteDataProvider data={data}>
      <ModuleLayout />
    </SiteDataProvider>
  );
}

/**
 * The module's routes, to be spread into the shell's router. `data` defaults
 * to the catalog bundled from `data/`; tests pass synthetic data.
 */
export function podcastsRoutes(data: SiteData = siteData): RouteObject[] {
  return [
    {
      path: "podcasts",
      element: <PodcastsLayout data={data} />,
      children: [
        { index: true, element: <HomePage /> },
        { path: "episode/:slug", element: <EpisodeRoute /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ];
}
