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
  compact = false,
  stacked = false,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** One slim line (title + description inline, no eyebrow): for list pages where the content matters more. */
  compact?: boolean;
  /** With `compact`: title, description and actions stacked (for a narrow column such as the side panel). */
  stacked?: boolean;
  className?: string;
}) {
  if (compact && stacked) {
    return (
      <header className={cn("pb-4", className)}>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        ) : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
    );
  }
  if (compact) {
    return (
      <header className={cn("pt-6 pb-3 sm:pt-8", className)}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            {description ? (
              <div className="text-sm text-muted-foreground sm:text-base">{description}</div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </header>
    );
  }
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
