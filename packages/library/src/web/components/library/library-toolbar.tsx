import { ChevronDownIcon } from "lucide-react";
import { SORT_KEYS, SORT_LABELS, type SortKey } from "@library/lib/library-query";
import { cn } from "@library/lib/utils";

// ---------------------------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------------------------

export function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (sort: SortKey) => void;
}) {
  // Native <select>: free keyboard, typeahead and mobile picker, no popper/listbox JS.
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="library-sort" className="hidden text-sm text-muted-foreground sm:inline">
        Ordina per
      </label>
      <div className="relative">
        <select
          id="library-sort"
          aria-label="Ordina per"
          value={value}
          onChange={(event) => onChange(event.target.value as SortKey)}
          className={cn(
            "h-9 cursor-pointer appearance-none rounded-full border border-input bg-card pr-9 pl-3.5 text-sm shadow-xs outline-none",
            "transition-[border-color,box-shadow] hover:bg-accent/50 sm:min-w-[9.5rem]",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
          )}
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}
