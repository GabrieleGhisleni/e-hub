import { useEffect } from "react";

export const SITE_NAME = "e-library";

/** Sets `document.title` to "<title> · e-library" (or just the site name). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}
