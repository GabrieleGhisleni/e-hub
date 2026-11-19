import { PanelLeftCloseIcon, PanelLeftOpenIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../utils";

/*
 * The left "shoulder" shared by every list page (library, podcasts, notes): a filter panel that can be collapsed on
 * wide screens and becomes a left sheet on narrow ones. The open/closed state is one preference for the whole app
 * (persisted), so moving between modules keeps the layout the user chose. Ctrl/⌘+B toggles it, as in most editors.
 */

const STORAGE_KEY = "ehub:side-panel";
const DESKTOP_QUERY = "(min-width: 64rem)"; // Tailwind `lg`

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

const hasMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

function subscribeDesktop(onChange: () => void) {
  if (!hasMatchMedia()) return () => {};
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True at `lg` and wider, where the panel is a column; below it the panel is a sheet. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => (hasMatchMedia() ? window.matchMedia(DESKTOP_QUERY).matches : true),
    () => true,
  );
}

interface SidePanelState {
  /** Desktop column hidden by the user. */
  collapsed: boolean;
  /** Mobile sheet open. */
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  /** Collapses/expands the column on desktop, opens/closes the sheet on mobile. */
  toggle: () => void;
  isDesktop: boolean;
  /** Whether the current page renders a panel (the shortcut does nothing elsewhere). */
  registerPanel: () => () => void;
  /** The element at the top of the desktop column where the page's search field + toggle are portaled. */
  searchSlot: HTMLElement | null;
  setSearchSlot: (element: HTMLElement | null) => void;
}

const SidePanelContext = createContext<SidePanelState | null>(null);

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panels, setPanels] = useState(0);
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "open");
    } catch {
      // Storage unavailable (private mode): the preference just isn't remembered.
    }
  }, [collapsed]);

  // Leaving the narrow layout closes the sheet, so it doesn't reappear when the window shrinks again.
  useEffect(() => {
    if (isDesktop) setSheetOpen(false);
  }, [isDesktop]);

  const toggle = useCallback(() => {
    if (isDesktop) setCollapsed((value) => !value);
    else setSheetOpen((value) => !value);
  }, [isDesktop]);

  const registerPanel = useCallback(() => {
    setPanels((n) => n + 1);
    return () => setPanels((n) => n - 1);
  }, []);

  useEffect(() => {
    if (panels === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.altKey)
        return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panels, toggle]);

  const value = useMemo(
    () => ({
      collapsed,
      sheetOpen,
      setSheetOpen,
      toggle,
      isDesktop,
      registerPanel,
      searchSlot,
      setSearchSlot,
    }),
    [collapsed, sheetOpen, toggle, isDesktop, registerPanel, searchSlot],
  );
  return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
}

export function useSidePanel(): SidePanelState {
  const context = useContext(SidePanelContext);
  if (!context) throw new Error("useSidePanel must be used inside <SidePanelProvider>");
  return context;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const SIDE_PANEL_SHORTCUT = isMac ? "⌘B" : "Ctrl+B";

/**
 * The button that shows/hides the panel. Desktop: an icon button (the panel's own state is visible next to it).
 * Mobile: "Filtri" with the number of active filters, since the panel is off-screen.
 */
export function SidePanelToggle({
  activeCount = 0,
  label = "Filtri",
  compact = false,
  className,
}: {
  activeCount?: number;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const { collapsed, sheetOpen, toggle, isDesktop } = useSidePanel();
  const expanded = isDesktop ? !collapsed : sheetOpen;
  const Icon = isDesktop && !compact
    ? collapsed
      ? PanelLeftOpenIcon
      : PanelLeftCloseIcon
    : SlidersHorizontalIcon;
  const action = expanded ? `Nascondi ${label.toLowerCase()}` : `Mostra ${label.toLowerCase()}`;
  const showLabel = compact || !isDesktop || collapsed;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      aria-controls={isDesktop && expanded ? "side-panel" : undefined}
      aria-label={showLabel ? undefined : action}
      title={`${action} (${SIDE_PANEL_SHORTCUT})`}
      className={cn(
        compact
          ? buttonVariants({ variant: "ghost", size: "sm" })
          : [
              "relative inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-input bg-card text-sm font-medium shadow-xs outline-none",
              "transition-[background-color,border-color,box-shadow] hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
              showLabel ? "px-4" : "w-11",
            ],
        activeCount > 0 && showLabel && "border-brand/40",
        className,
      )}
    >
      <Icon aria-hidden className={compact ? "size-4" : "size-[1.125rem] text-muted-foreground"} />
      {showLabel ? <span>{label}</span> : null}
      {activeCount > 0 ? (
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[0.7rem] font-semibold text-brand-foreground tabular-nums",
            !showLabel && "absolute -top-1 -right-1",
          )}
        >
          {activeCount}
          <span className="sr-only"> attivi</span>
        </span>
      ) : null}
    </button>
  );
}

/*
 * Two-column page body: the collapsible panel on the left, the content on the right. On narrow screens the panel
 * lives in a left sheet opened by `SidePanelToggle`; `mobileFooter` (e.g. "Mostra 12 libri") closes it.
 */

/**
 * Two-column page body (see `PanelLayout`). Works without a `SidePanelProvider` too (e.g. a module rendered alone
 * in tests): it then keeps its own, non-shared state.
 */
export function SidePanelLayout(props: SidePanelLayoutProps) {
  const context = useContext(SidePanelContext);
  if (context) return <PanelLayout {...props} />;
  return (
    <SidePanelProvider>
      <PanelLayout {...props} />
    </SidePanelProvider>
  );
}

interface SidePanelLayoutProps {
  title?: string;
  /** Screen-reader description of the sheet. */
  description?: string;
  /** Small action in the panel header, e.g. "Azzera". */
  headerAction?: ReactNode;
  /** Page title block. In the desktop column it tops the panel (stacked); otherwise it sits above the content. */
  header?: (stacked: boolean) => ReactNode;
  panel: ReactNode;
  mobileFooter?: ReactNode;
  children: ReactNode;
  className?: string;
}

function PanelLayout({
  title = "Filtri",
  description,
  headerAction,
  header,
  panel,
  mobileFooter,
  children,
  className,
}: SidePanelLayoutProps) {
  const { collapsed, sheetOpen, setSheetOpen, isDesktop, registerPanel, setSearchSlot } =
    useSidePanel();
  useEffect(registerPanel, [registerPanel]);
  const showColumn = isDesktop && !collapsed;

  return (
    <>
      {header && !showColumn ? <div className="pt-6 pb-3 sm:pt-8">{header(false)}</div> : null}
    <div
      className={cn(
        "lg:grid lg:gap-10 xl:gap-14",
        header && showColumn && "pt-6 sm:pt-8",
        showColumn
          ? "lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]"
          : "lg:grid-cols-1",
        className,
      )}
    >
      {showColumn ? (
        <aside id="side-panel" aria-label={title} className="hidden lg:block">
          <div className="sticky top-20 -ml-2.5 flex max-h-[calc(100dvh-6rem)] flex-col pl-2.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2">
            {header ? header(true) : null}
            <div ref={setSearchSlot} className="flex items-center gap-2 pb-5" />
            <div className="flex items-center justify-between gap-2 pb-4">
              <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
              <div className="flex items-center gap-1">{headerAction}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-3 pb-6 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
              {panel}
            </div>
          </div>
        </aside>
      ) : null}

      {!isDesktop ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="w-[min(22rem,88vw)] gap-0 p-0">
            <SheetHeader className="border-b border-border px-5 pt-5 pb-3">
              <div className="flex items-center gap-3 pr-8">
                <SheetTitle className="font-serif text-xl font-semibold">{title}</SheetTitle>
                {headerAction}
              </div>
              <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
              {panel}
            </div>
            {mobileFooter ? (
              <SheetFooter className="border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {mobileFooter}
              </SheetFooter>
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}

      <div className="min-w-0">{children}</div>
    </div>
    </>
  );
}
