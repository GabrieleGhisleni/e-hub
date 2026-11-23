import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ZlibraryStatusResponse } from "@shared/zlibrary";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import { adminApi } from "./api";
import { friendlyMessage } from "./lib/errors";
import { ZlibraryConnectForm } from "./zlibrary-connect-form";

/** Z-Library account: shows the state, connects (email + password, sent once) or disconnects. */
export function ZlibrarySettingsCard() {
  const [status, setStatus] = useState<ZlibraryStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [domain, setDomain] = useState("");
  const [defaultDomain, setDefaultDomain] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMessage, setDomainMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, settings] = await Promise.all([adminApi.zlibraryStatus(), adminApi.settings()]);
      setDomain(settings.zlibrary.baseUrl ?? "");
      setDefaultDomain(settings.zlibrary.defaultBaseUrl);
      setStatus(next);
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
      setChanging(false);
      void refresh();
    } catch (error) {
      setConnectError(friendlyMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function saveDomain(event: FormEvent) {
    event.preventDefault();
    setDomainBusy(true);
    setDomainMessage(null);
    try {
      await adminApi.saveSettings({ zlibraryBaseUrl: domain.trim() });
      await refresh();
      setDomainMessage(domain.trim() ? "Dominio salvato." : "Dominio predefinito ripristinato.");
    } catch (error) {
      setDomainMessage(friendlyMessage(error));
    } finally {
      setDomainBusy(false);
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
        {changing ? (
          <ZlibraryConnectForm onConnect={connect} busy={connecting} error={connectError} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setChanging((v) => !v)}>
            {changing ? "Annulla" : "Cambia account"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void disconnect()}>
            Scollega
          </Button>
        </div>
      </div>
    );
  }

  const domainForm = (
    <form onSubmit={saveDomain} className="mt-5 flex max-w-md flex-col gap-1.5 border-t border-border pt-4">
      <Label htmlFor="zlibrary-domain">Dominio</Label>
      <div className="flex gap-2">
        <Input
          id="zlibrary-domain"
          type="url"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={defaultDomain || "https://z-lib.sk"}
        />
        <Button type="submit" variant="outline" disabled={domainBusy}>
          Salva
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {domainMessage ??
          `Il dominio cambia spesso: se la ricerca non risponde, mettine uno nuovo (ad esempio https://z-lib.sk). Vuoto = ${defaultDomain || "predefinito"}. L'accesso resta valido.`}
      </p>
    </form>
  );

  return (
    <section className="rounded-lg border border-border p-5" aria-labelledby="settings-zlibrary">
      <h2 id="settings-zlibrary" className="font-serif text-lg font-medium">
        Z-Library
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Cerca e scarica EPUB per «Aggiungi libro → da Z-Library» e per le esplorazioni. L&apos;app conserva solo la chiave di sessione, mai la password.
      </p>
      {body}
      {status || loadError ? domainForm : null}
    </section>
  );
}
