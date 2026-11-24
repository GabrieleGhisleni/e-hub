/// <reference types="vite/client" />

/** Runtime flag: true only with a valid login. Set by `define` in vite.config.ts. */
declare const __ELIB_ADMIN__: boolean;

interface ImportMetaEnv {
  /** `1` in `pnpm dev`: the page logs in by itself as the owner (the local API allows it on loopback only). */
  readonly VITE_DEV_LOGIN?: string;
  /** Origin of the API (the Pi behind its tunnel), no trailing slash. */
  readonly VITE_API_URL?: string;
  /** Google OAuth client id for the login button. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** DSN of the Sentry browser project (public). Empty: Sentry off. */
  readonly VITE_SENTRY_DSN?: string;
}
