import { cn } from "../utils";

const MODULE_LABEL = {
  hub: null,
  library: "Libreria",
  podcasts: "Podcast",
} as const;

export function Logo({
  src,
  module = "hub",
  className,
  showWordmark = true,
}: {
  src: string;
  module?: "hub" | "library" | "podcasts";
  className?: string;
  /** Hide the serif "e-hub" text (the mark alone, e.g. on narrow screens). */
  showWordmark?: boolean;
}) {
  const moduleLabel = MODULE_LABEL[module];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src={src} width={36} height={36} alt="" className="size-9 shrink-0 rounded-md bg-[#faf5eb] p-0.5" />
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
