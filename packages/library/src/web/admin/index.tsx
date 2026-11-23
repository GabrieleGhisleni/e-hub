/**
 * Admin entry point (local dev UI only). Loaded lazily by src/web/admin-slots.tsx behind `if (__ELIB_ADMIN__)`,
 * so the Pages build contains none of this. The exports must satisfy `AdminModule` (./types.ts).
 */
export { AdminApp, adminRoutes } from "./routes";
export { LibraryAdminBar } from "./library-admin-bar";
export { NewTopicButton } from "./new-topic-button";
export { BookAdminActions } from "./book-admin-actions";
export { ADMIN_BUNDLE_MARKER } from "./marker";
export { AdminChrome } from "./admin-chrome";
export { ZlibrarySettingsCard } from "./zlibrary-settings-card";
export { KeysSettingsCard } from "./keys-settings-card";
export { ServicesHealthCard } from "./services-health-card";
