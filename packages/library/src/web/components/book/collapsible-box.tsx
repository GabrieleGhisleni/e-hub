/** A full-width section of the book page that folds to its header: title, count, extra actions, chevron. */
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@ehub/ui";

export function CollapsibleBox({
  id,
  title,
  count,
  actions,
  defaultOpen = true,
  className,
  children,
}: {
  /** Anchor of the section (in-page navigation). */
  id: string;
  title: string;
  /** Shown next to the title, e.g. the number of chapters. */
  count?: number;
  /** Controls on the right of the header, shown only while open (e.g. "Espandi tutto"). */
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-2xl border border-border bg-card", className)}>
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <h2 id={id} tabIndex={-1} className="min-w-0 flex-1 scroll-mt-6 outline-none">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className="group flex w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <span className="text-xl font-medium tracking-tight sm:text-2xl">{title}</span>
            {count !== undefined ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "ml-auto size-5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
                open && "rotate-180",
              )}
            />
          </button>
        </h2>
        {open && actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div id={bodyId} hidden={!open} className="border-t border-border/80 px-4 pb-5 sm:px-6">
        {children}
      </div>
    </section>
  );
}
