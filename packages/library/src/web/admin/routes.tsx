/**
 * Admin routes under `/admin/*` (local dev UI only).
 */
import { Link, type RouteObject, useRoutes } from "react-router";
import { AdminPage } from "./admin-page";
import { TopicsPage } from "./topics-page";
import { UploadPage } from "./upload-page";
import { libraryPath } from "@library/lib/paths";

function AdminNotFound() {
  return (
    <AdminPage title="Pagina di amministrazione non trovata">
      <p>
        <Link to={libraryPath("admin/upload")} className="text-brand underline underline-offset-4">
          Vai a &ldquo;Aggiungi libro&rdquo;
        </Link>
      </p>
    </AdminPage>
  );
}

/** Relative to `/admin`. */
export const adminRoutes: RouteObject[] = [
  { index: true, element: <UploadPage /> },
  { path: "upload", element: <UploadPage /> },
  { path: "topics", element: <TopicsPage /> },
];

export function AdminApp() {
  return useRoutes([...adminRoutes, { path: "*", element: <AdminNotFound /> }]);
}
