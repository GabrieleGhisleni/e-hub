import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { cn } from "./utils";
import { type ThemePreference, useTheme } from "./theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "system", label: "Automatico", Icon: MonitorIcon },
  { value: "light", label: "Chiaro", Icon: SunIcon },
  { value: "dark", label: "Scuro", Icon: MoonIcon },
];

/** Three-state segmented control (system / light / dark): no popup, each option is a tab stop. */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const activeLabel =
    theme === "system"
      ? `automatico, ${resolvedTheme === "dark" ? "scuro" : "chiaro"}`
      : (OPTIONS.find((option) => option.value === theme)?.label.toLowerCase() ?? "");

  return (
    <div
      role="group"
      aria-label={`Tema (attivo: ${activeLabel})`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-card/80 p-0.5 shadow-xs"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full sm:size-8 text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              selected && "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand",
            )}
          >
            <Icon aria-hidden className="size-3.5 sm:size-4" />
          </button>
        );
      })}
    </div>
  );
}
