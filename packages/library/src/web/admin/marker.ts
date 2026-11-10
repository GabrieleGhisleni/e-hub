/**
 * Unique string that exists only in the admin modules. The W3b check greps `dist/` for it after `pnpm build`
 * to prove the Pages bundle contains no admin code. Keep it referenced by every admin entry point.
 */
export const ADMIN_BUNDLE_MARKER = "elib-admin-bundle-7f3a9c";
