/** Tiny external store: the reconcile report the global dialog should show (see AdminChrome). */
import { useSyncExternalStore } from "react";
import type { ReconcileReport } from "@shared/api";

export interface ReportNotice {
  title: string;
  report: ReconcileReport;
}

let current: ReportNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showReport(notice: ReportNotice | null): void {
  current = notice;
  emit();
}

export function useReportNotice(): ReportNotice | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
