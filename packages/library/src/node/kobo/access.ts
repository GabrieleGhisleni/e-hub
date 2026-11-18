/**
 * Who may use the Kobo. The Kobo is one physical device on the owner's LAN, so in the hosted setup only the owner's
 * requests reach it (`KOBO_OWNER_EMAIL`): for everybody else every Kobo operation is a quiet no-op (no sync, no queue)
 * and the UI hides the section. Without a policy (CLI, local server, tests) the Kobo is always allowed.
 */
let policy: (() => boolean) | null = null;

/** The hosted API installs its rule here at boot (`() => current user is the owner`). `null` removes it. */
export function setKoboAccessPolicy(next: (() => boolean) | null): void {
  policy = next;
}

/** True when the current caller may touch the Kobo. */
export function koboAllowed(): boolean {
  return policy ? policy() : true;
}
