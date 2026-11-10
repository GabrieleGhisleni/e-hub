import { Link } from "react-router";
import { Container } from "@ehub/ui";

export function NotFoundPage() {
  return (
    <Container className="flex flex-col items-start gap-5 py-16 sm:py-24">
      <p className="eyebrow text-muted-foreground">404</p>
      <h1 className="display">Pagina non trovata</h1>
      <p className="max-w-prose text-muted-foreground">
        Il collegamento non esiste o è stato spostato.
      </p>
      <Link
        to="/"
        className="font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand"
      >
        Torna alla home
      </Link>
    </Container>
  );
}
