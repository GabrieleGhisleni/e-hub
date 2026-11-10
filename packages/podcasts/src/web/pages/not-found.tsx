import { Link, useLocation } from "react-router";
import { ArrowLeft, Compass } from "lucide-react";
import { StateMessage } from "@podcasts/components/states";
import { useDocumentTitle } from "@podcasts/components/site-layout";
import { Button } from "@ehub/ui/components/button";
import { PODCASTS_BASE } from "@podcasts/lib/paths";

export function NotFoundPage({
  title = "Pagina non trovata",
  message,
}: {
  title?: string;
  message?: string;
}) {
  useDocumentTitle(title);
  const { pathname } = useLocation();
  return (
    <StateMessage
      icon={Compass}
      title={title}
      headingLevel={1}
      className="py-20 sm:py-28"
      action={
        <Button asChild variant="outline">
          <Link to={PODCASTS_BASE}>
            <ArrowLeft aria-hidden /> Torna agli episodi
          </Link>
        </Button>
      }
    >
      {message ?? (
        <>
          L'indirizzo{" "}
          <code className="font-mono text-sm break-all text-foreground">{pathname}</code> non
          corrisponde a nessuna pagina.
        </>
      )}
    </StateMessage>
  );
}
