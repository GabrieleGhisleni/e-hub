/** Toasts for write outcomes; writes with warnings/errors also open the reconcile report dialog. */
import { toast } from "sonner";
import type { ReconcileReport, SummarizeResponse } from "@shared/api";
import { friendlyMessage } from "./lib/errors";
import { summaryDoneText } from "./lib/summary";
import { summarizeReport } from "./lib/report";
import { showReport } from "./report-store";
import { ApiRequestError } from "./lib/errors";

/** Success toast; if the report has warnings/errors, a warning toast and the report dialog instead. */
export function announceWrite(title: string, report: ReconcileReport): void {
  const summary = summarizeReport(report);
  if (!summary.needsAttention) {
    toast.success(title, { description: summary.done > 0 ? summary.text : undefined });
    return;
  }
  toast.warning(title, { description: summary.text, duration: 10_000 });
  showReport({ title, report });
}

/** Error toast; a `drive-failed` error also opens the report it carries. */
export function announceError(prefix: string, error: unknown): void {
  toast.error(prefix, { description: friendlyMessage(error), duration: 10_000 });
  if (error instanceof ApiRequestError && error.report) {
    showReport({ title: prefix, report: error.report });
  }
}

/** Success toast of a generated summary (the summary has no reconcile report: nothing goes to Drive). */
export function announceSummary(response: SummarizeResponse): void {
  toast.success(summaryDoneText(response));
}
