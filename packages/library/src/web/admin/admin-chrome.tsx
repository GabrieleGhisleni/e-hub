/**
 * Mounted once by the root layout (admin mode only): the sonner Toaster and the dialog that shows a reconcile
 * report after a write that produced warnings or errors.
 */
import { Button } from "@ehub/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ehub/ui/components/dialog";
import { Toaster } from "@ehub/ui/components/sonner";
import { TooltipProvider } from "@ehub/ui/components/tooltip";
import { ReconcileReportView } from "./reconcile-report";
import { showReport, useReportNotice } from "./report-store";

export function AdminChrome() {
  const notice = useReportNotice();
  return (
    <TooltipProvider>
      <Toaster position="bottom-right" closeButton />
      <Dialog open={notice !== null} onOpenChange={(open) => !open && showReport(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Resoconto della riconciliazione</DialogTitle>
            <DialogDescription>{notice?.title}</DialogDescription>
          </DialogHeader>
          {notice ? <ReconcileReportView report={notice.report} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => showReport(null)}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
