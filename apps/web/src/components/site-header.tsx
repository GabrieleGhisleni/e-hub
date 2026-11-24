import { Link, NavLink } from "react-router";
import { cn, Container, Logo } from "@ehub/ui";
import { LogIn } from "lucide-react";
import { currentSession } from "../session";

const logoUrl = `${import.meta.env.BASE_URL}ehub.svg`;

const NAV_ITEMS = [
  { to: "/library", label: "Libreria" },
  { to: "/podcasts", label: "Podcast" },
  { to: "/explore", label: "Esplorazioni" },
  { to: "/notes", label: "Note" },
] as const;

function AccountLink() {
  const label = currentSession ? `Account di ${currentSession.email}` : "Accedi";

  return (
    <NavLink
      to="/settings"
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cn(
          "col-start-2 row-start-1 inline-flex min-h-10 items-center justify-center gap-2 justify-self-end rounded-full px-3 text-sm font-medium sm:col-start-3",
          isActive ? "bg-brand-soft text-brand" : "hover:bg-muted",
          currentSession && "size-10 bg-brand-soft px-0 text-brand",
        )
      }
    >
      {currentSession ? (
        <span aria-hidden>{currentSession.email.slice(0, 1).toLocaleUpperCase("it-IT")}</span>
      ) : (
        <>
          <LogIn aria-hidden className="size-4" />
          Accedi
        </>
      )}
    </NavLink>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <Container className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 pt-2 sm:min-h-16 sm:grid-cols-[1fr_auto_1fr] sm:py-0">
        <Link to="/" className="w-fit rounded-md py-1" aria-label="e-hub, torna alla home">
          <Logo src={logoUrl} />
        </Link>
        <nav aria-label="Principale" className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <ul className="flex flex-wrap items-center justify-between gap-x-1 sm:justify-center sm:gap-x-3">
            {NAV_ITEMS.map(({ to, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex min-h-10 items-center whitespace-nowrap border-b-2 px-1 text-sm font-medium sm:min-h-16 sm:px-2",
                      isActive ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <AccountLink />
      </Container>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer data-module="library" className="mt-auto border-t bg-card">
      <Container className="flex flex-col gap-5 py-7 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/" aria-label="e-hub, torna alla home" className="w-fit rounded-md">
          <Logo src={logoUrl} />
        </Link>
        <nav aria-label="Piè di pagina">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {NAV_ITEMS.map(({ to, label }) => (
              <li key={to}>
                <Link to={to} className="hover:text-foreground">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm text-muted-foreground">© Gabriele Ghisleni</p>
      </Container>
    </footer>
  );
}
