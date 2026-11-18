import { GoogleSignIn } from "../components/account-button";
import { GOOGLE_CLIENT_ID } from "../session";

/** Hosted site without a session: nothing is loaded until the user logs in; then only their own data is shown. */
export function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">e-hub</h1>
      <p className="text-sm text-muted-foreground">
        Libri, podcast, note ed esplorazioni. Accedi con Google per vedere i tuoi dati.
      </p>
      {GOOGLE_CLIENT_ID ? (
        <GoogleSignIn />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Accesso non configurato (manca VITE_GOOGLE_CLIENT_ID).
        </p>
      )}
    </main>
  );
}
