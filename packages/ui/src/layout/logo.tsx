import { cn } from "../utils";

const MODULE_LABEL = {
  hub: null,
  library: "Libreria",
  podcasts: "Podcast",
} as const;

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
      <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0 text-brand">
        <rect width="32" height="32" rx="9" fill="currentColor" />
        <path
          d="M8 9.5h4c2.2 0 4 1.8 4 4v9c0-2.2-1.8-4-4-4H8zm16 0h-4c-2.2 0-4 1.8-4 4v9c0-2.2 1.8-4 4-4h4z"
          fill="none"
          stroke="var(--brand-foreground)"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
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
