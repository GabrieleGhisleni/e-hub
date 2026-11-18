/**
 * Hosted setup: the Kobo sleeps, so syncs wait in a queue (docs/hosting.md). Shows how many books are waiting and
 * lets you try the sync right away. Renders nothing when the queue is empty or the API does not answer.
 */
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@ehub/ui/components/button";

const QUEUE_URL = "/api/library/kobo/queue";
const SYNC_URL = "/api/library/kobo/sync";

export async function fetchPending(fetchImpl: typeof fetch = fetch): Promise<number> {
  try {
    const response = await fetchImpl(QUEUE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) return 0;
    const body = (await response.json()) as { pending?: unknown };
    return Array.isArray(body.pending) ? body.pending.length : 0;
  } catch {
    return 0;
  }
}

export function KoboQueueStatus() {
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => void fetchPending().then(setPending), []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (pending === 0) return null;

  const syncNow = async () => {
    setBusy(true);
    try {
      const response = await fetch(SYNC_URL, { method: "POST" });
      const body = (await response.json()) as { status?: string };
      if (!response.ok) toast.error("Sincronizzazione non riuscita.");
      else if (body.status === "asleep") toast.info("Il Kobo è spento: riproverò da solo ogni 5 minuti.");
      else toast.success("Kobo sincronizzato.");
    } catch {
      toast.error("Non riesco a raggiungere il server.");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
      {pending === 1 ? "1 libro in attesa del Kobo" : `${pending} libri in attesa del Kobo`}
      <Button variant="ghost" size="sm" onClick={syncNow} disabled={busy}>
        <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
        Sincronizza ora
      </Button>
    </span>
  );
}
