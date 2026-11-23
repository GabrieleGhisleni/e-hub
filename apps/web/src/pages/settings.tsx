import { KeyRound, LogOut } from "lucide-react";
import { useState } from "react";
import { KeysSettingsSlot, ServicesHealthSlot, ZlibrarySettingsSlot } from "@ehub/library/web";
import { Container, PageHeader, ThemeToggle } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { GOOGLE_CLIENT_ID, HOSTED, currentSession, logout } from "../session";
import { GoogleSignIn } from "../components/account-button";

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-5" aria-labelledby={id}>
      <h2 id={id} className="font-serif text-lg font-medium">
        {title}
      </h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AccountSection() {
  const [copied, setCopied] = useState<"idle" | "ok" | "error">("idle");
  if (!HOSTED) {
    return (
      <p className="text-sm text-muted-foreground">
        Sviluppo locale: nessun accesso richiesto, i dati sono quelli di questo computer.
      </p>
    );
  }
  if (!currentSession) {
    return GOOGLE_CLIENT_ID ? (
      <GoogleSignIn />
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        L’accesso con Google non è configurato.
      </p>
    );
  }
  const session = currentSession;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Collegato come <strong>{session.email}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.clipboard.writeText(session.token).then(
              () => setCopied("ok"),
              () => setCopied("error"),
            )
          }
        >
          <KeyRound aria-hidden />
          <span role="status">
            {copied === "ok" ? "Copiato (vale 30 giorni)" : copied === "error" ? "Copia non riuscita" : "Copia il token per la CLI"}
          </span>
        </Button>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut aria-hidden />
          Esci
        </Button>
      </div>
    </div>
  );
}

/** App-wide settings: appearance, account, linked services. */
export function SettingsPage() {
  return (
    <Container className="pb-16">
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader eyebrow="e-hub" title="Impostazioni" description="Aspetto, account e servizi collegati." className="pt-8 pb-0" />
        <div className="mt-8 flex flex-col gap-6">
          <Section id="settings-theme" title="Aspetto" hint="Tema chiaro, scuro o quello del sistema.">
            <ThemeToggle />
          </Section>
          <Section id="settings-account" title="Account">
            <AccountSection />
          </Section>
          <ServicesHealthSlot />
          <KeysSettingsSlot />
          <ZlibrarySettingsSlot />
        </div>
      </div>
    </Container>
  );
}
