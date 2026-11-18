import { KeyRound, LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@ehub/ui/components/button";
import { HOSTED, currentSession, login, logout } from "../session";

/** Login with Google for the hosted site; nothing in the local dev UI. */
export function AccountButton() {
  const [copied, setCopied] = useState<"idle" | "ok" | "error">("idle");
  if (!HOSTED) return null;
  const session = currentSession;
  return session ? (
    <>
      <Button
        variant="ghost"
        size="sm"
        title="Copia il token per la CLI (EHUB_API_TOKEN)"
        aria-label="Copia il token per la CLI"
        onClick={() => {
          navigator.clipboard.writeText(session.token).then(
            () => setCopied("ok"),
            () => setCopied("error"),
          );
        }}
      >
        <KeyRound aria-hidden className="size-4" />
        <span className="hidden sm:inline" role="status">
          {copied === "ok" ? "Copiato (7 giorni)" : copied === "error" ? "Copia non riuscita" : "Token CLI"}
        </span>
      </Button>
      <Button variant="ghost" size="sm" onClick={logout} title={session.email} aria-label={`Esci (${session.email})`}>
        <LogOut aria-hidden className="size-4" />
        <span className="hidden sm:inline">Esci</span>
      </Button>
    </>
  ) : (
    <Button variant="ghost" size="sm" onClick={login} aria-label="Accedi con Google">
      <LogIn aria-hidden className="size-4" />
      <span className="hidden sm:inline">Accedi</span>
    </Button>
  );
}
