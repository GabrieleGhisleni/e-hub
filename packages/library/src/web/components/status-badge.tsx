import { STATUS_LABELS } from "@shared/labels";
import type { BookStatus } from "@shared/schema";
import { cn } from "@library/lib/utils";

/** Dot colour per status (tokens in index.css; text stays in the foreground colour for contrast). */
export const STATUS_DOT: Readonly<Record<BookStatus, string>> = {
  "to-read": "bg-status-to-read",
  reading: "bg-status-reading",
  read: "bg-status-read",
  abandoned: "bg-status-abandoned",
};

export function StatusDot({ status, className }: { status: BookStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status], className)}
    />
  );
}

export function StatusBadge({ status, className }: { status: BookStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-medium",
        className,
      )}
    >
      <StatusDot status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}
