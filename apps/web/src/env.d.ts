/// <reference types="vite/client" />

/** True in the local dev UI (`vite` serve), false in the static build. Set by `define` in vite.config.ts. */
declare const __ELIB_ADMIN__: boolean;

interface ImportMetaEnv {
  /** `1` in the hosted build: data comes from the API, admin controls need a login. */
  readonly VITE_HOSTED?: string;
  /** Origin of the API (the Pi behind its tunnel), no trailing slash. */
  readonly VITE_API_URL?: string;
}
