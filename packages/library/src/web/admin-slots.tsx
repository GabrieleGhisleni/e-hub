/**
 * Public-side mount points for the admin UI (src/web/admin, owned by W4a).
 *
 * `__ELIB_ADMIN__` is a Vite `define`: `true` in dev, `false` in the Pages build. Every `import()` of the admin
 * module sits inside `if (__ELIB_ADMIN__)`, so the production build drops it (no admin chunk at all; W3b checks
 * that the admin marker string is absent from dist/). In public mode the slots render nothing.
 */
import { type ComponentType, lazy, Suspense } from "react";
import type { AdminModule, BookAdminActionsProps, LibraryAdminBarProps } from "./admin/types";

let AdminApp: ComponentType | null = null;
let AdminChrome: ComponentType | null = null;
let LibraryAdminBar: ComponentType<LibraryAdminBarProps> | null = null;
let BookAdminActions: ComponentType<BookAdminActionsProps> | null = null;
let NewTopicButton: ComponentType | null = null;

if (__ELIB_ADMIN__) {
  const load = (): Promise<AdminModule> => import("./admin/index.tsx");
  AdminApp = lazy(() => load().then((m) => ({ default: m.AdminApp })));
  AdminChrome = lazy(() => load().then((m) => ({ default: m.AdminChrome })));
  LibraryAdminBar = lazy(() => load().then((m) => ({ default: m.LibraryAdminBar })));
  BookAdminActions = lazy(() => load().then((m) => ({ default: m.BookAdminActions })));
  NewTopicButton = lazy(() => load().then((m) => ({ default: m.NewTopicButton as ComponentType })));
}

/** Element for the `admin/*` route (only registered when `__ELIB_ADMIN__`). */
export function AdminAppSlot() {
  if (!AdminApp) return null;
  return (
    <Suspense
      fallback={<p className="px-6 py-16 text-center text-muted-foreground">Caricamento…</p>}
    >
      <AdminApp />
    </Suspense>
  );
}

/** Toaster + report dialog of the admin UI; rendered once by the root layout. */
export function AdminChromeSlot() {
  if (!AdminChrome) return null;
  return (
    <Suspense fallback={null}>
      <AdminChrome />
    </Suspense>
  );
}

export function LibraryAdminBarSlot(props: LibraryAdminBarProps) {
  if (!LibraryAdminBar) return null;
  return (
    <Suspense fallback={null}>
      <LibraryAdminBar {...props} />
    </Suspense>
  );
}

export function BookAdminActionsSlot(props: BookAdminActionsProps) {
  if (!BookAdminActions) return null;
  return (
    <Suspense fallback={null}>
      <BookAdminActions {...props} />
    </Suspense>
  );
}

/** "+" next to the topic filters: adds a topic. */
export function NewTopicSlot() {
  if (!NewTopicButton) return null;
  return (
    <Suspense fallback={null}>
      <NewTopicButton />
    </Suspense>
  );
}
