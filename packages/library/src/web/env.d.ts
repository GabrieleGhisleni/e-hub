/// <reference types="vite/client" />

/** True in the local dev UI (`vite` serve), false in the static Pages build. Set by `define` in vite.config.ts. */
declare const __ELIB_ADMIN__: boolean;

interface ImportMetaEnv {
  readonly VITE_HOSTED?: string;
}
