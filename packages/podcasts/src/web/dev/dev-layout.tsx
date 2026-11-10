import { useEffect } from "react";
import { Toaster } from "@ehub/ui/components/sonner";
import { showPendingFlash } from "./storage";

/** Mounted once in the layout: toasts, and the message left by a write that reloaded the page. */
export function DevLayout() {
  useEffect(() => {
    showPendingFlash();
  }, []);
  return <Toaster position="bottom-right" richColors closeButton />;
}
