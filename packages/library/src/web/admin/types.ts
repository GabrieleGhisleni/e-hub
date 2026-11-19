/**
 * Contract between the public SPA (W3b) and the admin UI (W4a). Type-only: the public code imports these
 * types, never the admin modules, so nothing from src/web/admin reaches the Pages bundle.
 *
 * Wiring (public side, see src/web/admin-slots.tsx): each export of `./index.tsx` is loaded with
 * `React.lazy(() => import("./admin/index.tsx"))` inside `if (__ELIB_ADMIN__)`.
 */
import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import type { BookCard, BookDetail, SiteIndex } from "@shared/schema";

/** Rendered above the library grid (between the toolbar and the grid). */
export interface LibraryAdminBarProps {
  /** The whole index (all books + topics). */
  index: SiteIndex;
  /** Books currently shown in the grid (after search/filters/sort), in display order. */
  visibleBooks: readonly BookCard[];
}

/** Rendered in the book page header, next to the title. */
export interface BookAdminActionsProps {
  book: BookDetail;
  placement: "toolbar" | "cover" | "summary";
  /** The loaded index (topics for pickers), or undefined if it has not loaded (yet). */
  index: SiteIndex | undefined;
}

/** What `src/web/admin/index.tsx` must export. */
export interface AdminModule {
  /** Routes under `/admin/*`, relative paths ("upload", "topics", …). Rendered with `useRoutes`. */
  adminRoutes: RouteObject[];
  /** Renders `adminRoutes` (plus an admin 404); mounted by the public router at `admin/*`. */
  AdminApp: () => ReactNode;
  /** Toaster + report dialog; mounted once by the root layout. */
  AdminChrome: () => ReactNode;
  LibraryAdminBar: (props: LibraryAdminBarProps) => ReactNode;
  BookAdminActions: (props: BookAdminActionsProps) => ReactNode;
  /** "+" to add a topic (next to the topic filters). */
  /** Z-Library account card of the app settings page. */
  ZlibrarySettingsCard: () => ReactNode;
  /** Personal AI / Groq keys card of the app settings page. */
  KeysSettingsCard: () => ReactNode;
  NewTopicButton: (props: { onCreated?: (topic: { id: string; label: string }) => void }) => ReactNode;
}
