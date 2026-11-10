import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@ehub/ui/components/badge";
import { cn } from "@library/lib/utils";

export interface CoverOption {
  key: string;
  label: string;
  /** Image URL; options without one render `fallback` (e.g. the placeholder). */
  src?: string;
  fallback?: ReactNode;
  badge?: string;
  /** Small print under the label (matched title, size…). */
  caption?: ReactNode;
}

interface CoverPickerProps {
  legend: string;
  options: CoverOption[];
  value: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
}

/** Candidate covers side by side; one radio-style choice, with a visible selected state. */
export function CoverPicker({ legend, options, value, onChange, disabled }: CoverPickerProps) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div role="radiogroup" aria-label={legend} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {options.map((option) => {
          const selected = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.key)}
              className={cn(
                "group flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2 text-left transition-colors outline-none",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "border-brand ring-2 ring-brand/40"
                  : "border-border hover:border-foreground/30",
              )}
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-sm bg-muted">
                {option.src ? (
                  <img
                    src={option.src}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="size-full">{option.fallback}</div>
                )}
                {selected ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-brand text-background"
                  >
                    <CheckIcon className="size-3.5" />
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.badge ? (
                    <Badge variant="outline" className="border-amber-500/60 text-[0.6875rem]">
                      {option.badge}
                    </Badge>
                  ) : null}
                </div>
                {option.caption ? (
                  <p className="text-xs break-words text-muted-foreground">{option.caption}</p>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
