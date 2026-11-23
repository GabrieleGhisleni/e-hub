import { CheckCircle2Icon, CircleSlashIcon, Loader2Icon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ServiceCheck, ServicesHealthResponse } from "@shared/settings";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import { adminApi } from "./api";
import { friendlyMessage } from "./lib/errors";

const ICON = {
  ok: <CheckCircle2Icon className="size-5 text-status-read" aria-label="Funziona" />,
  error: <XCircleIcon className="size-5 text-destructive" aria-label="Non funziona" />,
  off: <CircleSlashIcon className="size-5 text-muted-foreground" aria-label="Non configurato" />,
} as const;

function Row({ check }: { check: ServiceCheck }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0">{ICON[check.status]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{check.label}</p>
        <p className="text-sm break-words text-muted-foreground">{check.detail}</p>
      </div>
      {check.ms !== null ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{check.ms} ms</span>
      ) : null}
    </li>
  );
}

/** Stato dei servizi collegati: backend, database, AI e Z-Library, ricontrollabili a mano. */
export function ServicesHealthCard() {
  const [health, setHealth] = useState<ServicesHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      setHealth(await adminApi.servicesHealth());
      setError(null);
    } catch (cause) {
      // The backend itself does not answer: that is the answer.
      setError(friendlyMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <section className="rounded-lg border border-border p-5" aria-labelledby="settings-health">
      <div className="flex items-center justify-between gap-3">
        <h2 id="settings-health" className="font-serif text-lg font-medium">
          Stato dei servizi
        </h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void check()}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
          Ricontrolla
        </Button>
      </div>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        Backend, database, AI e Z-Library: se qualcosa non va, qui c&apos;è il motivo.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>Backend non raggiungibile: {error}</AlertDescription>
        </Alert>
      ) : health ? (
        <>
          <ul className="divide-y divide-border">
            {health.checks.map((item) => (
              <Row key={item.id} check={item} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Controllato alle {new Date(health.checkedAt).toLocaleTimeString("it-IT")}
          </p>
        </>
      ) : (
        <Loader2Icon className="animate-spin text-muted-foreground" aria-label="Caricamento" />
      )}
    </section>
  );
}
