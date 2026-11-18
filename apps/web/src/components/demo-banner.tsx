import { GOOGLE_CLIENT_ID, HOSTED, currentSession } from "../session";
import { GoogleSignIn } from "./account-button";

/** Hosted site without a session: a read-only demo with invented examples, plus the Google login. */
export function isDemo(): boolean {
  return HOSTED && currentSession === null;
}

export function DemoBanner() {
  if (!isDemo()) return null;
  return (
    <div
      role="region"
      aria-label="Demo"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b bg-muted px-4 py-2 text-sm"
    >
      <p>
        <strong>Stai guardando una demo.</strong> Esempi inventati, in sola lettura: per i tuoi dati accedi.
      </p>
      {GOOGLE_CLIENT_ID ? (
        <GoogleSignIn />
      ) : (
        <span role="alert" className="text-destructive">
          Accesso non configurato (manca VITE_GOOGLE_CLIENT_ID).
        </span>
      )}
    </div>
  );
}
