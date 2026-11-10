import { Link, NavLink } from "react-router";
import { cn, Container, Logo, ThemeToggle } from "@ehub/ui";

const NAV_ITEMS = [
  { to: "/library", label: "Libreria" },
  { to: "/podcasts", label: "Podcast" },
  { to: "/notes", label: "Note" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Container className="flex h-14 items-center justify-between gap-3 sm:h-16 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link
            to="/"
            className="group -mx-1 flex shrink-0 items-center rounded-md px-1 py-1"
            aria-label="e-hub, torna alla home"
          >
            <Logo showWordmark={false} className="sm:hidden" />
            <Logo className="hidden sm:inline-flex" />
          </Link>
          <nav aria-label="Principale" className="min-w-0">
            <ul className="flex items-center gap-0.5 sm:gap-1">
              {NAV_ITEMS.map(({ to, label }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
                        isActive
                          ? "bg-brand-soft text-brand"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <ThemeToggle />
      </Container>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <Container className="flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link to="/" className="font-serif text-base font-semibold text-foreground">
            e-hub
          </Link>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {NAV_ITEMS.map(({ to, label }) => (
              <Link key={to} to={to} className="transition-colors hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-xs tracking-wide sm:text-sm">Una sola app, lo stesso stile</p>
      </Container>
    </footer>
  );
}
