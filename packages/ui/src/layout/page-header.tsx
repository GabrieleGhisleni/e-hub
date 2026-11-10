import type { ReactNode } from "react";
import { cn } from "../utils";

/**
 * Top of a page: eyebrow, serif display title, optional lead paragraph and an actions slot.
 * Actions sit to the right on wide screens and wrap below the text on phones.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("pt-10 pb-6 sm:pt-14", className)}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-3 text-brand">{eyebrow}</p> : null}
          <h1 className="display">{title}</h1>
          {description ? (
            <div className="mt-4 max-w-prose text-base text-muted-foreground sm:text-lg">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
