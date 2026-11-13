import { AlertTriangleIcon, CheckCircle2Icon, CircleXIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ReconcileReport } from "@shared/api";
import { cn } from "@library/lib/utils";
import { ACTION_STATUS_LABEL, ACTION_TYPE_LABEL, baseName, summarizeReport } from "./lib/report";

function Section({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: ReactNode;
  tone: "error" | "warning" | "neutral";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone === "error" && "border-destructive/40 bg-destructive/5",
        tone === "warning" && "border-amber-500/40 bg-amber-500/5",
        tone === "neutral" && "border-border bg-card",
      )}
    >
      <h3
        className={cn(
          "flex items-center gap-1.5 font-sans text-sm font-semibold",
          tone === "error" && "text-destructive",
        )}
      >
        {icon}
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1.5 text-sm">{children}</ul>
    </section>
  );
}

/** What a write did on the Kobo: actions done, warnings, errors. Reusable after any write. */
export function ReconcileReportView({ report }: { report: ReconcileReport }) {
  const summary = summarizeReport(report);
  return (
    <div className="space-y-3" data-testid="reconcile-report">
      <p className="text-sm text-muted-foreground">{summary.text}</p>

      {report.errors.length > 0 ? (
        <Section
          title={report.errors.length === 1 ? "Errore" : `Errori (${report.errors.length})`}
          tone="error"
          icon={<CircleXIcon className="size-4" />}
        >
          {report.errors.map((e, i) => (
            <li key={i}>
              {e.message}
              {e.path ? <code className="ml-1 text-xs break-all opacity-80">{e.path}</code> : null}
            </li>
          ))}
          <li className="text-muted-foreground">
            I dati della libreria sono stati salvati. Per completare l&rsquo;allineamento accendi il
            Kobo, collegalo al Wi-Fi ed esegui{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">elib sync</code>.
          </li>
        </Section>
      ) : null}

      {report.warnings.length > 0 ? (
        <Section
          title={report.warnings.length === 1 ? "Avviso" : `Avvisi (${report.warnings.length})`}
          tone="warning"
          icon={<AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-400" />}
        >
          {report.warnings.map((w, i) => (
            <li key={i}>
              {w.message}
              {w.path ? <code className="ml-1 text-xs break-all opacity-80">{w.path}</code> : null}
            </li>
          ))}
        </Section>
      ) : null}

      {report.actions.length > 0 ? (
        <Section
          title={`Operazioni sul Kobo (${report.actions.length})`}
          tone="neutral"
          icon={<CheckCircle2Icon className="size-4 text-status-read" />}
        >
          {report.actions.map((a, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{ACTION_TYPE_LABEL[a.type]}</span>
              <span
                className={cn(
                  "text-xs",
                  a.status === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {ACTION_STATUS_LABEL[a.status]}
              </span>
              <span className="min-w-0 text-xs break-all text-muted-foreground">
                {baseName(a.to ?? a.from)}
              </span>
            </li>
          ))}
        </Section>
      ) : null}
    </div>
  );
}
