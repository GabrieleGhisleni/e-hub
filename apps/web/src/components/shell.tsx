import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { ExplorationBadges } from "@ehub/explore";
import { SidePanelProvider, type SourceExtraRef, SourceExtrasProvider } from "@ehub/ui";
import { DemoBanner } from "./demo-banner";
import { SiteFooter, SiteHeader } from "./site-header";

/** Which module the current URL belongs to: it selects the accent (data-module) for the whole shell. */
function moduleFor(pathname: string) {
  if (pathname === "/library" || pathname.startsWith("/library/")) return "library";
  if (pathname === "/podcasts" || pathname.startsWith("/podcasts/")) return "podcasts";
  if (pathname === "/notes" || pathname.startsWith("/notes/")) return "notes";
  // Explorations have no accent of their own: they reuse the library's.
  if (pathname === "/explore" || pathname.startsWith("/explore/")) return "library";
  return undefined;
}

/** Extra content on library pages (the explorations a book appears in); the modules do not import each other. */
function renderSourceExtras(ref: SourceExtraRef) {
  return ref.kind === "book" ? <ExplorationBadges bookId={ref.id} /> : null;
}

/** Layout shared by every route: skip link, header, the active module inside <main>, footer. */
export function Shell() {
  const { pathname } = useLocation();
  return (
    <SourceExtrasProvider render={renderSourceExtras}>
      <SidePanelProvider>
        <div
          data-module={moduleFor(pathname)}
          className="flex min-h-dvh flex-col bg-background text-foreground"
        >
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
          >
            Vai al contenuto
          </a>
          <DemoBanner />
          <SiteHeader />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            <Outlet />
          </main>
          <SiteFooter />
          <ScrollRestoration />
        </div>
      </SidePanelProvider>
    </SourceExtrasProvider>
  );
}
