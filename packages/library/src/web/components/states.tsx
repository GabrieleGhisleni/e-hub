import { BookOpenIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@ehub/ui/components/button";
import { cn } from "@library/lib/utils";

/** Centered message block for empty, error and not-found states. */
export function MessageState({
  title,
  children,
  action,
  icon,
  className,
  headingLevel = 2,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Glyph inside the brand tile; defaults to an open book. */
  icon?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center py-8 text-center sm:py-12",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand [&_svg]:size-6"
      >
        {icon ?? <BookOpenIcon />}
      </span>
      <Heading className="mt-6 font-serif text-2xl leading-tight font-medium tracking-tight text-balance sm:text-3xl">
        {title}
      </Heading>
      {children ? (
        <div className="mt-3 text-pretty text-[0.9375rem] text-muted-foreground sm:text-base">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Loading failure with a retry button. */
export function ErrorState({
  title,
  error,
  onRetry,
  className,
}: {
  title: string;
  error?: Error;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <MessageState
      title={title}
      className={className}
      icon={<TriangleAlertIcon />}
      action={
        <Button variant="outline" onClick={onRetry}>
          <RefreshCwIcon />
          Riprova
        </Button>
      }
    >
      <p role="alert">
        Controlla la connessione e riprova.
        {error ? <span className="mt-2 block text-xs opacity-80">{error.message}</span> : null}
      </p>
    </MessageState>
  );
}
