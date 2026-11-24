/**
 * Feature-module entry, mounted by the shell under `PODCASTS_BASE`.
 *
 * The shell owns the document: global header/footer, `<main id="main">` and
 * the router (and its basename). This module contributes one route subtree.
 */
import { useEffect, useState } from "react";
import type { RouteObject } from "react-router";
import { ModuleLayout } from "@podcasts/components/site-layout";
import { EpisodeRoute } from "@podcasts/pages/episode";
import { HomePage } from "@podcasts/pages/home";
import { NotFoundPage } from "@podcasts/pages/not-found";
import { loadRemoteSiteData } from "@podcasts/data";
import { SiteDataProvider, type SiteData } from "@podcasts/site-data";

export { PODCASTS_BASE } from "@podcasts/lib/paths";

/** The catalog arrives from the API before the pages render. */
function RemotePodcastsLayout() {
  const [state, setState] = useState<{ data: SiteData } | { error: Error } | null>(null);
  useEffect(() => {
    let active = true;
    loadRemoteSiteData().then(
      (data) => active && setState({ data }),
      (error: unknown) => active && setState({ error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      active = false;
    };
  }, []);
  if (!state) return <p className="px-6 py-16 text-center text-muted-foreground">Caricamento…</p>;
  if ("error" in state) {
    return (
      <p role="alert" className="px-6 py-16 text-center text-muted-foreground">
        Non riesco a raggiungere il server dei dati. Riprova tra poco.
      </p>
    );
  }
  return <PodcastsLayout data={state.data} />;
}

function PodcastsLayout({ data }: { data: SiteData }) {
  return (
    <SiteDataProvider data={data}>
      <ModuleLayout />
    </SiteDataProvider>
  );
}

/**
 * The module's routes, to be spread into the shell's router. `data` defaults
 * to the catalog fetched from the API; tests pass synthetic data.
 */
export function podcastsRoutes(data?: SiteData): RouteObject[] {
  return [
    {
      path: "podcasts",
      element: data ? <PodcastsLayout data={data} /> : <RemotePodcastsLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: "episode/:slug", element: <EpisodeRoute /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ];
}
