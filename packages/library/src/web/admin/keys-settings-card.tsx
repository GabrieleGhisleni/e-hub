import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SettingsResponse } from "@shared/settings";
import { Alert, AlertDescription } from "@ehub/ui/components/alert";
import { Button } from "@ehub/ui/components/button";
import { Input } from "@ehub/ui/components/input";
import { Label } from "@ehub/ui/components/label";
import { adminApi } from "./api";
import { friendlyMessage } from "./lib/errors";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function keyHint(has: boolean, source: "personal" | "env" | null): string {
  if (!has) return "Non impostata.";
  return source === "env" ? "Impostata in .env.local (solo in locale)." : "Impostata. Lasciala vuota per non cambiarla.";
}

/** The user's own keys: LLM router for the chat and the summaries, Groq for the transcriptions. Keys are never shown back. */
export function KeysSettingsCard() {
  const [state, setState] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");

  const apply = useCallback((next: SettingsResponse) => {
    setState(next);
    setBaseUrl(next.ai.baseUrl ?? "");
    setModel(next.ai.model ?? "");
  }, []);

  useEffect(() => {
    adminApi.settings().then(apply, (e: unknown) => setError(friendlyMessage(e)));
  }, [apply]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      apply(
        await adminApi.saveSettings({
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(groqKey.trim() ? { groqApiKey: groqKey.trim() } : {}),
        }),
      );
      setApiKey("");
      setGroqKey("");
      setSaved(true);
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear(field: "apiKey" | "groqApiKey") {
    setBusy(true);
    setError(null);
    try {
      apply(await adminApi.saveSettings({ [field]: null }));
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-5" aria-labelledby="settings-keys">
      <h2 id="settings-keys" className="font-serif text-lg font-medium">
        Chiavi personali
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Sono solo tue: servono alla chat AI, ai riassunti e alle trascrizioni dei tuoi contenuti. Restano sul server, in
        un file riservato, e non vengono mai mostrate di nuovo.
      </p>
      {!state && !error ? <Loader2Icon className="animate-spin text-muted-foreground" aria-label="Caricamento" /> : null}
      {state ? (
        <form onSubmit={save} className="flex max-w-md flex-col gap-4">
          <Field id="ai-base-url" label="Chat AI: indirizzo del router" hint="Compatibile OpenAI, ad esempio https://…/v1. Vuoto = predefinito.">
            <Input id="ai-base-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
          </Field>
          <Field id="ai-key" label="Chat AI: chiave API" hint={keyHint(state.ai.hasKey, state.ai.source)}>
            <div className="flex gap-2">
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={state.ai.hasKey ? "••••••••" : ""}
              />
              {state.ai.source === "personal" ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clear("apiKey")}>
                  Rimuovi
                </Button>
              ) : null}
            </div>
          </Field>
          <Field id="ai-model" label="Chat AI: modello" hint="Vuoto = predefinito («smart»).">
            <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="smart" />
          </Field>
          <Field id="groq-key" label="Groq: chiave API" hint={keyHint(state.groq.hasKey, state.groq.source)}>
            <div className="flex gap-2">
              <Input
                id="groq-key"
                type="password"
                autoComplete="off"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder={state.groq.hasKey ? "••••••••" : ""}
              />
              {state.groq.source === "personal" ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clear("groqApiKey")}>
                  Rimuovi
                </Button>
              ) : null}
            </div>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Salva
            </Button>
            {saved ? <span role="status" className="text-sm text-muted-foreground">Salvato.</span> : null}
          </div>
        </form>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
