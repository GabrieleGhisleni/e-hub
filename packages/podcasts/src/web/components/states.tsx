import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@podcasts/lib/utils";

/**
 * Centered message for empty, not-found and no-result states: a brand tile
 * with an icon, a serif title, muted text and an optional action.
 */
export function StateMessage({
  icon: Icon,
  title,
  children,
  action,
  className,
  headingLevel = 2,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center py-16 text-center", className)}>
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Icon className="size-7" aria-hidden />
      </span>
      <Heading className="mt-5 font-serif text-2xl font-medium tracking-tight text-balance sm:text-3xl">
        {title}
      </Heading>
      {children ? <div className="mt-3 text-pretty text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
