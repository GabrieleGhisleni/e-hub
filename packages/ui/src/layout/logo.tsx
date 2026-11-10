import { cn } from "../utils";

const MODULE_LABEL = {
  hub: null,
  library: "Libreria",
  podcasts: "Podcast",
} as const;

/**
 * The e-hub mark: a rounded tile in --brand (so it follows the active module's accent) holding an open book
 * whose two pages are rendered as audio-wave bars. Decorative: the link around it carries the accessible name.
 */
export function Logo({
  module = "hub",
  className,
  showWordmark = true,
}: {
  module?: "hub" | "library" | "podcasts";
  className?: string;
  /** Hide the serif "e-hub" text (the mark alone, e.g. on narrow screens). */
  showWordmark?: boolean;
}) {
  const moduleLabel = MODULE_LABEL[module];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-6 shrink-0 text-brand">
        <rect x="0" y="0" width="32" height="32" rx="8" fill="currentColor" />
        <g fill="var(--brand-foreground)">
          <rect x="7" y="10" width="2.4" height="12" rx="1.2" />
          <rect x="10.8" y="8" width="2.4" height="16" rx="1.2" />
          <rect x="14.6" y="12" width="2.4" height="8" rx="1.2" />
          <rect x="18.4" y="12" width="2.4" height="8" rx="1.2" />
          <rect x="22.2" y="8" width="2.4" height="16" rx="1.2" />
          <rect x="26" y="10" width="2.4" height="12" rx="1.2" />
        </g>
      </svg>
      {showWordmark ? (
        <span className="flex items-baseline gap-2">
          <span className="font-serif text-xl leading-none font-semibold tracking-tight sm:text-[1.375rem]">
            e-hub
          </span>
          {moduleLabel ? (
            <span className="text-sm text-muted-foreground">{moduleLabel}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
