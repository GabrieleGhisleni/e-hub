import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { Container } from "@ehub/ui";
import { DevSlot } from "@podcasts/dev-slot";

export const SITE_NAME = "e-podcasts";

/** Sets `document.title` ("<title> · e-podcasts", or just the site name). */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}

// Scroll positions per history entry, so "back" returns to the same place in the list.
const scrollPositions = new Map<string, number>();

function useScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const currentKey = useRef(location.key);
  const lastPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const save = () => scrollPositions.set(currentKey.current, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);

  useLayoutEffect(() => {
    currentKey.current = location.key;
    if (lastPath.current === location.pathname) {
      // Same page, new history entry (filters changed): keep the position.
      scrollPositions.set(location.key, window.scrollY);
      return;
    }
    lastPath.current = location.pathname;
    window.scrollTo(0, navigationType === "POP" ? (scrollPositions.get(location.key) ?? 0) : 0);
  }, [location.key, location.pathname, navigationType]);
}

/**
 * Layout of the module's pages. The shell provides the global header, footer
 * and `<main>`; this uses the hub's container, so the content lines up with
 * the header logo. Each page sets its own reading width and page header.
 */
export function ModuleLayout() {
  useScrollRestoration();
  return (
    <Container className="pb-16">
      <Outlet />
      <DevSlot name="layout" />
    </Container>
  );
}
