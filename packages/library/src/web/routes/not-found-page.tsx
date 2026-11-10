import { CompassIcon, TriangleAlertIcon } from "lucide-react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Container } from "@ehub/ui";
import { MessageState } from "@library/components/states";
import { Button } from "@ehub/ui/components/button";
import { useDocumentTitle } from "@library/hooks/use-document-title";
import { libraryPath } from "@library/lib/paths";

/** Unknown route or unknown book ID (the SPA is also served as 404.html on Pages). */
export function NotFoundPage({ kind = "page" }: { kind?: "page" | "book" }) {
  const title = kind === "book" ? "Libro non trovato" : "Pagina non trovata";
  useDocumentTitle(title);
  return (
    <Container className="max-w-3xl pt-12 pb-16 sm:pt-20">
      <MessageState
        headingLevel={1}
        title={title}
        icon={<CompassIcon />}
        action={
          <Button asChild>
            <Link to={libraryPath()}>Torna alla biblioteca</Link>
          </Button>
        }
      >
        <p>
          {kind === "book"
            ? "Questo libro non è (o non è più) nella biblioteca. Forse il link è vecchio o incompleto."
            : "L’indirizzo che hai seguito non corrisponde a nessuna pagina del sito."}
        </p>
      </MessageState>
    </Container>
  );
}

/** Router error boundary: unexpected render/loader errors. */
export function RouteErrorPage() {
  const error = useRouteError();
  useDocumentTitle("Errore");
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const message = error instanceof Error ? error.message : null;
  return (
    <Container className="max-w-3xl pt-12 pb-16 sm:pt-20">
      <MessageState
        headingLevel={1}
        title="Qualcosa è andato storto"
        icon={<TriangleAlertIcon />}
        action={
          <>
            <Button onClick={() => window.location.reload()}>Ricarica la pagina</Button>
            <Button asChild variant="outline">
              <a href={libraryPath()}>Torna alla biblioteca</a>
            </Button>
          </>
        }
      >
        <p>Si è verificato un errore imprevisto.</p>
        {message ? <p className="mt-2 text-xs opacity-80">{message}</p> : null}
      </MessageState>
    </Container>
  );
}
