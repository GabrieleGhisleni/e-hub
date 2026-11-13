/** Error type of the admin API client and its Italian messages (pure, unit-tested). */
import {
  ReconcileReportSchema,
  type ApiErrorCode,
  type ReconcileReport,
} from "../../../shared/api.ts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "network" | "bad-response" | (string & {});
  readonly details: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = "ApiRequestError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  /** The reconcile report carried by a 502 `kobo-failed`, when present. */
  get report(): ReconcileReport | null {
    const details = this.details as { report?: unknown } | null | undefined;
    if (!details || typeof details !== "object" || details.report === undefined) return null;
    const parsed = ReconcileReportSchema.safeParse(details.report);
    return parsed.success ? parsed.data : null;
  }
}

/**
 * A response that is not our JSON error envelope and has this status comes from the dev proxy (or a gateway)
 * because the API server is down: 500 (proxy error), 502, 503 or 504. The real server always answers JSON.
 */
export function isServerDownStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

const HINTS: Partial<Record<string, string>> = {
  network:
    "Impossibile raggiungere il server locale. Controlla che sia avviato (pnpm dev o pnpm server).",
  "forbidden-host": "Il server locale ha rifiutato l’indirizzo da cui stai aprendo l’interfaccia.",
  "forbidden-origin":
    "Il server locale ha rifiutato l’origine della pagina: aggiungila a server.allowedOrigins in elib.config.json.",
  "origin-required":
    "Il server locale richiede l’origine della richiesta: riapri la pagina dal browser.",
  "upload-not-found": "Il caricamento è scaduto o è già stato eliminato: carica di nuovo il file.",
  "cover-changed":
    "La copertina di Open Library è cambiata nel frattempo: ricarica i candidati e riprova.",
  "zlibrary-not-configured":
    "Configura le credenziali Z-Library in packages/library/.env e riavvia il server.",
  "zlibrary-limit": "Hai raggiunto il limite giornaliero di download di Z-Library: riprova domani.",
  "zlibrary-failed": "Z-Library non ha risposto come previsto: riprova tra poco.",
};

/** Message to show in a toast or an inline alert. API messages are Italian already; transport errors are mapped. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const hint = HINTS[error.code];
    if (hint && (error.code === "network" || error.message.trim() === "")) return hint;
    if (error.code === "forbidden-origin" || error.code === "forbidden-host")
      return hint ?? error.message;
    if (
      error.code === "upload-not-found" ||
      error.code === "cover-changed" ||
      error.code === "zlibrary-not-configured" ||
      error.code === "zlibrary-limit"
    )
      return hint ?? error.message;
    return error.message || `Errore del server (HTTP ${error.status}).`;
  }
  if (error instanceof Error && error.message) return `Errore imprevisto: ${error.message}`;
  return "Errore imprevisto.";
}

/** Whether repeating the same request may succeed (server/Kobo trouble, not a rejected input). */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return error.status >= 500 || error.code === "network";
}
