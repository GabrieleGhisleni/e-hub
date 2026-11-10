import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { SidePanelToggle, useSidePanel } from "./layout/side-panel";
import { cn } from "./utils";

/*
 * Search and filter building blocks shared by every list page, so the library, the podcasts and the notes look and
 * behave the same: one search field, one sticky toolbar, one style for facet rows, chips and active-filter pills.
 */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** The search field: "/" focuses it, Escape clears it (then blurs), a clear button appears while it has text. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible label (visually hidden). */
  label: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const id = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);

  return (
    <form
      role="search"
      className={cn("relative min-w-0 flex-1", className)}
      onSubmit={(event) => {
        event.preventDefault();
        ref.current?.blur();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={ref}
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (value !== "") {
            event.preventDefault();
            onChange("");
          } else {
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "h-11 w-full rounded-full border border-input bg-card pr-11 pl-10 text-base shadow-xs outline-none",
          "transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-foreground/25",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {value !== "" ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          aria-label="Cancella la ricerca"
        >
          <XIcon className="size-4" />
        </button>
      ) : (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded border border-border px-1.5 font-sans text-xs text-muted-foreground sm:block"
        >
          /
        </kbd>
      )}
    </form>
  );
}

/**
 * Sticky bar under the global header: panel toggle, search field, then compact page actions. Full-bleed
 * background on phones so the list scrolls cleanly under it.
 */
export function SearchToolbar({
  search,
  actions,
  activeFilterCount = 0,
  className,
}: {
  search: ReactNode;
  actions?: ReactNode;
  activeFilterCount?: number;
  className?: string;
}) {
  const { isDesktop, collapsed, searchSlot } = useSidePanel();
  // Desktop with the column open: the toggle + search live at the top of the left column; only page actions stay here.
  if (isDesktop && !collapsed && searchSlot) {
    return (
      <>
        {createPortal(
          <>
            <SidePanelToggle activeCount={activeFilterCount} />
            {search}
          </>,
          searchSlot,
        )}
        {actions ? (
          <div className={cn("flex items-center justify-end gap-2 py-3", className)}>{actions}</div>
        ) : null}
      </>
    );
  }
  return (
    <div
      className={cn(
        "sticky top-14 z-20 -mx-4 bg-background/90 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sm:top-16 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <SidePanelToggle activeCount={activeFilterCount} />
        {search}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A titled group in the side panel. */
export function FacetSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3
          id={id}
          className="font-sans text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Vertical stack of facet sections with consistent spacing. */
export function FacetStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-8", className)}>{children}</div>;
}

/**
 * One row of a facet list. `kind` sets the marker: "single" (a bar, one of many), "multi" (a checkbox).
 * Rows with zero matches stay clickable when selected, and are dimmed otherwise.
 */
export function FacetOption({
  label,
  count,
  selected,
  onSelect,
  kind = "multi",
  icon,
}: {
  label: ReactNode;
  count?: number;
  selected: boolean;
  onSelect: () => void;
  kind?: "single" | "multi";
  icon?: ReactNode;
}) {
  const empty = count === 0 && !selected;
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[0.9375rem] transition-colors outline-none",
          "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
          selected ? "bg-brand-soft font-medium text-foreground" : "text-foreground/85",
          empty && "text-muted-foreground",
        )}
      >
        {kind === "single" ? (
          <span
            aria-hidden
            className={cn(
              "mr-2 h-4 w-0.5 shrink-0 rounded-full transition-colors",
              selected ? "bg-brand" : "bg-transparent",
            )}
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              "mr-2.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
              selected ? "border-brand bg-brand text-brand-foreground" : "border-input bg-card",
            )}
          >
            {selected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
          </span>
        )}
        {icon ? <span className="mr-2 flex shrink-0 items-center">{icon}</span> : null}
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined ? (
          <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </button>
    </li>
  );
}

export function FacetList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="-mx-2.5 flex flex-col gap-0.5" aria-label={label}>
      {children}
    </ul>
  );
}

/** A toggleable pill (tags). */
export function FacetChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        disabled={count === 0 && !selected}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          "disabled:cursor-default disabled:opacity-45",
          selected
            ? "border-brand/50 bg-brand-soft font-medium text-foreground"
            : "border-border bg-card text-foreground/90 enabled:hover:border-brand/40 enabled:hover:bg-accent",
        )}
      >
        {label}
        {count !== undefined ? (
          <span
            className={cn(
              "text-xs tabular-nums",
              selected ? "text-brand" : "text-muted-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function FacetChips({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {children}
    </ul>
  );
}

/** "Mostra tutti (n)" / "Mostra meno" under a long facet list. */
export function ShowMoreButton({
  expanded,
  total,
  onToggle,
  noun,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
  noun: string;
}) {
  return (
    <button
      type="button"
      className="mt-3 rounded text-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? `Mostra meno ${noun}` : `Mostra tutti i ${noun} (${total})`}
    </button>
  );
}

/** Small "Azzera" link for the panel header. */
export function ClearFiltersButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1.5 py-1 text-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:text-muted-foreground/60"
    >
      Azzera
    </button>
  );
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Result count + removable pills for each active filter + "Azzera filtri". Announced politely. */
export function ActiveFilters({
  summary,
  chips,
  onClear,
  actions,
}: {
  summary: ReactNode;
  chips: readonly ActiveFilterChip[];
  onClear: () => void;
  /** Right-aligned extras (e.g. sort on wide screens). */
  actions?: ReactNode;
}) {
  return (
    <div className="mt-1 mb-5 flex flex-col gap-2.5 sm:mb-7">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p
          className="min-w-0 text-sm text-muted-foreground tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {summary}
        </p>
        {actions}
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ul className="flex flex-wrap gap-1.5" aria-label="Filtri attivi">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="group inline-flex h-7 items-center gap-1 rounded-full border border-brand/30 bg-brand-soft pr-1.5 pl-3 text-sm text-foreground transition-colors outline-none hover:border-brand/60 hover:bg-brand/15 focus-visible:ring-3 focus-visible:ring-ring/40"
                  aria-label={`Rimuovi filtro: ${chip.label}`}
                >
                  <span className="max-w-[14rem] truncate">{chip.label}</span>
                  <XIcon aria-hidden className="size-3.5 text-brand/70 group-hover:text-brand" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onClear}
            className="rounded text-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Azzera filtri
          </button>
        </div>
      ) : null}
    </div>
  );
}
