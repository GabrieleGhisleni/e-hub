/**
 * Public API of the library feature module. The shell imports this file (`@ehub/library/web`), mounts
 * `libraryRoutes()` as a child route of its router and renders its own global header/footer around the Outlet.
 *
 * The shell renders `<main id="main">` around its Outlet, so nothing here renders a second `<main>`.
 */
import { type RouteObject, Outlet, ScrollRestoration } from "react-router";
import { AdminAppSlot, AdminChromeSlot } from "./admin-slots";
import { BookPage } from "./routes/book-page";
import { LibraryPage } from "./routes/library-page";
import { NotFoundPage, RouteErrorPage } from "./routes/not-found-page";
import { SelectionProvider } from "./selection";

export { BookCover } from "./components/book-cover";
export { useSiteIndex } from "./data/site-data";
export { KeysSettingsSlot, ServicesHealthSlot, ZlibrarySearchSlot, ZlibrarySettingsSlot } from "./admin-slots";
export { LIBRARY_BASE } from "./lib/paths";

/** Layout of the library subtree: no header/footer/skip-link (the shell owns them). */
function LibraryLayout() {
  const content = (
    <>
      <Outlet />
      {/* Restores the scroll position on back/forward (keyed by history entry). */}
      <ScrollRestoration />
    </>
  );
  // Bulk selection exists only in the local admin UI; in the public build this branch is dead code.
  if (__ELIB_ADMIN__) {
    return (
      <SelectionProvider>
        {content}
        <AdminChromeSlot />
      </SelectionProvider>
    );
  }
  return content;
}

/**
 * One route object mounted at `library` (relative to the shell). Children are relative to `/library`.
 * Admin routes exist only in the local dev UI (`__ELIB_ADMIN__`).
 */
export function libraryRoutes(): RouteObject[] {
  const children: RouteObject[] = [
    { index: true, element: <LibraryPage /> },
    { path: "book/:id/:slug?", element: <BookPage /> },
  ];
  if (__ELIB_ADMIN__) {
    children.push({ path: "admin/*", element: <AdminAppSlot /> });
  }
  children.push({ path: "*", element: <NotFoundPage /> });
  return [
    { path: "library", element: <LibraryLayout />, errorElement: <RouteErrorPage />, children },
  ];
}
