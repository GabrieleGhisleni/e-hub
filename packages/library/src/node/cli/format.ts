/** Plain-text rendering of reconcile reports and tables for the CLI. */
import type {
  ReconcileAction,
  ReconcileActionType,
  ReconcileMessage,
  ReconcileReport,
} from "../../shared/api.ts";

const ACTION_ORDER: readonly ReconcileActionType[] = ["rename", "upload", "metadata", "remove"];

const ACTION_TITLES: Record<ReconcileActionType, string> = {
  rename: "Renamed on the Kobo",
  upload: "Uploaded to the Kobo",
  metadata: "Series metadata written",
  remove: "Deleted from the Kobo",
};

function actionLine(a: ReconcileAction): string {
  const id = a.bookId ? `  [${a.bookId}]` : "";
  const what =
    a.type === "rename"
      ? `${a.from ?? "?"} → ${a.to ?? "?"}`
      : a.type === "upload"
        ? `${a.to ?? "?"}  (from ${a.from ?? "cache"})`
        : a.type === "metadata"
          ? (a.to ?? "?")
          : (a.from ?? a.to ?? "?");
  return `  ${`[${a.status}]`.padEnd(9)} ${what}${id}`;
}

function messageLine(m: ReconcileMessage): string {
  const where = [m.bookId ? `book ${m.bookId}` : "", m.path ?? ""].filter(Boolean).join(", ");
  return `  ${m.code}: ${m.message}${where ? `  (${where})` : ""}`;
}

/** Actions grouped by type, then warnings and errors grouped by code, then a summary line. */
export function formatReport(report: ReconcileReport): string[] {
  const lines: string[] = [];
  if (report.dryRun) lines.push("Dry run: nothing was changed. Planned actions:");
  for (const type of ACTION_ORDER) {
    const actions = report.actions.filter((a) => a.type === type);
    if (actions.length === 0) continue;
    lines.push(`${ACTION_TITLES[type]} (${actions.length})`);
    lines.push(...actions.map(actionLine));
  }
  for (const [title, messages] of [
    ["Warnings", report.warnings],
    ["Errors", report.errors],
  ] as const) {
    if (messages.length === 0) continue;
    lines.push(`${title} (${messages.length})`);
    const sorted = [...messages].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    lines.push(...sorted.map(messageLine));
  }
  lines.push(reportSummary(report));
  return lines;
}

export function reportSummary(report: ReconcileReport): string {
  const count = (status: ReconcileAction["status"]) =>
    report.actions.filter((a) => a.status === status).length;
  const parts =
    report.actions.length === 0
      ? ["nothing to do"]
      : report.dryRun
        ? [`${report.actions.length} action(s) planned`]
        : [
            `${count("done")} action(s) done`,
            ...(count("failed") > 0 ? [`${count("failed")} failed`] : []),
          ];
  return `${parts.join(", ")}; ${report.warnings.length} warning(s), ${report.errors.length} error(s)`;
}

/** Left-aligned text table (cells truncated to `maxWidth`). */
export function formatTable(header: string[], rows: string[][], maxWidth = 40): string[] {
  const clip = (s: string) => {
    const chars = [...s];
    return chars.length > maxWidth ? `${chars.slice(0, maxWidth - 1).join("")}…` : s;
  };
  const all = [header, ...rows].map((r) => r.map(clip));
  const widths = header.map((_, i) => Math.max(...all.map((r) => [...(r[i] ?? "")].length)));
  const render = (r: string[]) =>
    r
      .map((cell, i) => cell + " ".repeat(Math.max(0, widths[i]! - [...cell].length)))
      .join("  ")
      .trimEnd();
  return [
    render(all[0]!),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...all.slice(1).map(render),
  ];
}
