import { LogIn, LogOut } from "lucide-react";
import { Button } from "@ehub/ui/components/button";
import { HOSTED, currentSession, login, logout } from "../session";

/** Login with Google for the hosted site; nothing in the local dev UI. */
export function AccountButton() {
  if (!HOSTED) return null;
  return currentSession ? (
    <Button variant="ghost" size="sm" onClick={logout} title={currentSession.email} aria-label={`Esci (${currentSession.email})`}>
      <LogOut aria-hidden className="size-4" />
      <span className="hidden sm:inline">Esci</span>
    </Button>
  ) : (
    <Button variant="ghost" size="sm" onClick={login} aria-label="Accedi con Google">
      <LogIn aria-hidden className="size-4" />
      <span className="hidden sm:inline">Accedi</span>
    </Button>
  );
}
