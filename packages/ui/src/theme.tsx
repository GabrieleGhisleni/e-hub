/**
 * Theme preference: "system" (default, follows prefers-color-scheme), "light" or "dark".
 * Applied as the `dark` class on <html> (class-based, see theme.css). The inline script in apps/web/index.html
 * does the same before first paint: keep THEME_STORAGE_KEY and THEME_COLORS in sync with it.
 * Ported from packages/library/src/web/theme/theme.ts (storage key changed to "ehub-theme").
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ehub-theme";
/** Browser UI colour (address bar on phones): the page background of each theme. */
const THEME_COLORS = { light: "#f8f5ef", dark: "#13161d" } as const;

const darkQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage blocked (private mode, sandbox): fall back to the system theme.
  }
  return "system";
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisted; the choice still applies to this page view.
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return darkQuery()?.matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

// Tiny store so every consumer agrees, plus system and cross-tab changes.
let preference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function current(): ThemePreference {
  preference ??= readThemePreference();
  return preference;
}

function setPreference(next: ThemePreference): void {
  preference = next;
  writeThemePreference(next);
  applyTheme(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = darkQuery();
  const onSystemChange = () => {
    if (current() !== "system") return;
    applyTheme("system");
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    preference = readThemePreference();
    applyTheme(preference);
    listener();
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

const currentResolved = (): ResolvedTheme => resolveTheme(current());

interface ThemeContextValue {
  /** What the user chose: "system", "light" or "dark". */
  theme: ThemePreference;
  /** What is applied to the page right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, current, () => "system" as const);
  const resolvedTheme = useSyncExternalStore(subscribe, currentResolved, () => "light" as const);
  const setTheme = useCallback((next: ThemePreference) => setPreference(next), []);

  // Make sure <html> and theme-color match the stored preference (the inline script already did, this is idempotent).
  useEffect(() => {
    applyTheme(current());
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
