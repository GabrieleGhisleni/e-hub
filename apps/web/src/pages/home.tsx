import { ArrowUpRight, BookOpen, Compass, Headphones } from "lucide-react";
import { Link } from "react-router";
import { Container } from "@ehub/ui";

const destinations = [
  {
    to: "/library",
    module: "library",
    title: "Libreria",
    description: "Scegli la prossima lettura o riprendi un libro.",
    icon: BookOpen,
  },
  {
    to: "/podcasts",
    module: "podcasts",
    title: "Podcast",
    description: "Ritrova gli episodi, le trascrizioni e gli appunti di ascolto.",
    icon: Headphones,
  },
  {
    to: "/explore",
    module: "notes",
    title: "Esplorazioni",
    description: "Parti da una domanda e metti a confronto più libri.",
    icon: Compass,
  },
] as const;

export function HomePage() {
  return (
    <Container className="max-w-7xl py-12 sm:py-20 lg:py-24">
      <h1 className="display max-w-3xl text-5xl leading-[0.95] sm:text-7xl lg:text-8xl">
        Leggi, ascolta, esplora.
      </h1>
      <nav aria-label="Sezioni di e-hub" className="mt-8 sm:mt-12">
        <ul className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          {destinations.map(({ to, module, title, description, icon: Icon }) => (
            <li key={to} data-module={module} className="min-w-0">
              <Link
                to={to}
                className="group grid h-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-6 rounded-2xl border bg-linear-to-br from-brand-soft via-card to-card p-5 transition-colors hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:p-7 lg:gap-y-14"
              >
                <Icon className="size-8 text-brand" strokeWidth={1.5} aria-hidden />
                <ArrowUpRight
                  className="size-5 self-start text-brand transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                  aria-hidden
                />
                <div className="col-span-2">
                  <h2 className="display text-3xl sm:text-4xl">{title}</h2>
                  <p className="mt-2 max-w-60 text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Container>
  );
}
