import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ZlibraryStatusResponse } from "@shared/zlibrary";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import { adminApi } from "./api";
import { friendlyMessage } from "./lib/errors";
import { ZlibraryConnectForm } from "./zlibrary-connect-form";

/** Z-Library account: shows the state, connects (email + password, sent once) or disconnects. */
export function ZlibrarySettingsCard() {
  const [status, setStatus] = useState<ZlibraryStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await adminApi.zlibraryStatus());
      setLoadError(null);
    } catch (error) {
      setLoadError(friendlyMessage(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function connect(email: string, password: string) {
    setConnecting(true);
    setConnectError(null);
    try {
      setStatus(await adminApi.zlibraryConnect(email, password));
      void refresh();
    } catch (error) {
      setConnectError(friendlyMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await adminApi.zlibraryDisconnect();
      await refresh();
    } catch (error) {
      setLoadError(friendlyMessage(error));
    }
  }

  let body;
  if (loadError) {
    body = (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  } else if (!status) {
    body = <Loader2Icon className="animate-spin text-muted-foreground" aria-label="Caricamento" />;
  } else if (!status.configured) {
    body = <ZlibraryConnectForm onConnect={connect} busy={connecting} error={connectError} />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Collegata{status.account ? <> come <strong>{status.account}</strong></> : null}
          <span className="text-muted-foreground"> · {status.baseUrl}</span>
        </p>
        {status.quota && status.quota.limit > 0 ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            Download di oggi: {status.quota.today}/{status.quota.limit}
          </p>
        ) : null}
        {status.error ? (
          <Alert variant="destructive">
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button variant="outline" size="sm" onClick={() => void disconnect()}>
            Scollega
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border p-5" aria-labelledby="settings-zlibrary">
      <h2 id="settings-zlibrary" className="font-serif text-lg font-medium">
        Z-Library
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Serve per «Aggiungi libro → da Z-Library». L&apos;app conserva solo la chiave di sessione, mai la password.
      </p>
      {body}
    </section>
  );
}
