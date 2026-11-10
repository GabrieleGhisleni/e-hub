import {
  ArrowRightIcon,
  BookOpenIcon,
  HeadphonesIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  PinIcon,
} from "lucide-react";
import { Link } from "react-router";
import { Container, PageHeader } from "@ehub/ui";
import { notesCount, useNotes } from "@ehub/notes";

/* Each card carries its module's accent on its own element (data-module), so the wash, icon tile, link and
 * focus ring take the module colour regardless of the home page's own (library) accent. */
export function HomePage() {
  const notes = useNotes();
  const pinned = notes.filter((note) => note.pinned).length;
  return (
    <Container className="pb-16 sm:pb-24">
      <PageHeader
        eyebrow="e-hub"
        title="Libri e podcast, in un unico posto."
        description="Scegli da dove cominciare: la libreria oppure i podcast."
      />

      <div className="mt-8 grid gap-5 md:mt-10 md:grid-cols-2">
        <HubCard
          module="library"
          to="/library"
          title="Libreria"
          description="Libri, letture e appunti di lettura."
          Icon={BookOpenIcon}
        />
        <HubCard
          module="podcasts"
          to="/podcasts"
          title="Podcast"
          description="Episodi, trascrizioni e note di ascolto."
          Icon={HeadphonesIcon}
        />
      </div>

      <Link
        to="/notes"
        data-module="notes"
        className="group mt-5 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition duration-200 ease-out hover:border-brand/40 hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-6"
      >
        <span className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand/15">
            <MessageSquareTextIcon aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block font-serif text-2xl font-semibold tracking-tight">
              Le mie note
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {notes.length === 0
                ? "Appunti personali su libri ed episodi, con ricerca e note fissate."
                : `${notesCount(notes.length)}${pinned > 0 ? ` · ${pinned} ${pinned === 1 ? "fissata" : "fissate"}` : ""} su libri ed episodi.`}
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
          {pinned > 0 ? <PinIcon aria-hidden className="size-3.5" /> : null}
          Apri le note
          <ArrowRightIcon
            aria-hidden
            className="size-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1"
          />
        </span>
      </Link>
    </Container>
  );
}

function HubCard({
  module,
  to,
  title,
  description,
  Icon,
}: {
  module: "library" | "podcasts";
  to: string;
  title: string;
  description: string;
  Icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      data-module={module}
      className="group flex min-h-60 flex-col justify-between gap-10 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-soft/70 via-card to-card p-6 text-card-foreground shadow-sm transition duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg sm:p-8"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand/15">
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <span className="block">
        <span className="display block text-4xl sm:text-5xl">{title}</span>
        <span className="mt-3 block max-w-prose text-base text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
        Apri
        <ArrowRightIcon
          aria-hidden
          className="size-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}
