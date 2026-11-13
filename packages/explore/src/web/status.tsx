import { CompassIcon, RotateCcwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { type ExploreStore, exploreStore, useExploreMeta } from "./store.ts";

/** The last load failure, with "Riprova" and dismiss. Renders nothing when there is no error. */
export function ExploreErrorBanner({
  store = exploreStore,
  className,
}: {
  store?: ExploreStore;
  className?: string;
}) {
  const { error } = useExploreMeta(store);
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm",
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 break-words">{error}</p>
      <div className="-my-1 flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" onClick={() => void store.reload()}>
          <RotateCcwIcon aria-hidden /> Riprova
        </Button>
        <button
          type="button"
          onClick={() => store.dismissError()}
          aria-label="Chiudi l'avviso"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Centered message for empty and not-found states. */
export function MessageState({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-10 text-center sm:py-14">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand [&_svg]:size-6"
      >
        {icon ?? <CompassIcon />}
      </span>
      <h2 className="mt-6 font-serif text-2xl leading-tight font-medium tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
      {children ? (
        <div className="mt-3 text-[0.9375rem] text-muted-foreground">{children}</div>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
