/** Summaries of reconcile reports and API errors for the UI (pure, unit-tested). */
import type { ReconcileAction, ReconcileReport } from "../../../shared/api.ts";

export interface ReportSummary {
  done: number;
  planned: number;
  failed: number;
  warnings: number;
  errors: number;
  /** Warnings or errors or failed actions: the report deserves to be shown. */
  needsAttention: boolean;
  /** One Italian sentence, e.g. "2 file caricati, 1 spostato · 1 errore". */
  text: string;
}

const DONE_LABEL: Record<ReconcileAction["type"], [string, string]> = {
  upload: ["file caricato su Drive", "file caricati su Drive"],
  move: ["file spostato", "file spostati"],
  trash: ["file nel cestino", "file nel cestino"],
  rmdir: ["cartella vuota rimossa", "cartelle vuote rimosse"],
};

export const ACTION_TYPE_LABEL: Record<ReconcileAction["type"], string> = {
  upload: "Caricamento",
  move: "Spostamento",
  trash: "Cestino",
  rmdir: "Rimozione cartella",
};

export const ACTION_STATUS_LABEL: Record<ReconcileAction["status"], string> = {
  planned: "previsto",
  done: "fatto",
  failed: "fallito",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarizeReport(report: ReconcileReport): ReportSummary {
  const done = report.actions.filter((a) => a.status === "done");
  const planned = report.actions.filter((a) => a.status === "planned").length;
  const failed = report.actions.filter((a) => a.status === "failed").length;
  const parts: string[] = [];
  for (const type of Object.keys(DONE_LABEL) as ReconcileAction["type"][]) {
    const n = done.filter((a) => a.type === type).length;
    if (n > 0) parts.push(plural(n, ...DONE_LABEL[type]));
  }
  const problems: string[] = [];
  if (report.errors.length > 0) problems.push(plural(report.errors.length, "errore", "errori"));
  if (report.warnings.length > 0) {
    problems.push(plural(report.warnings.length, "avviso", "avvisi"));
  }
  let text = parts.length > 0 ? parts.join(", ") : "Nessuna operazione su Drive";
  if (problems.length > 0) text += ` · ${problems.join(", ")}`;
  return {
    done: done.length,
    planned,
    failed,
    warnings: report.warnings.length,
    errors: report.errors.length,
    needsAttention: report.errors.length > 0 || report.warnings.length > 0 || failed > 0,
    text,
  };
}

/** Last path segment, for compact action lines. */
export function baseName(path: string | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
