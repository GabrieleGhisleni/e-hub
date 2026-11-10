import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Container, PageHeader } from "@ehub/ui";
import { Button } from "@ehub/ui/components/button";
import { useDocumentTitle } from "@library/hooks/use-document-title";
import { cn } from "@library/lib/utils";
import { ADMIN_BUNDLE_MARKER } from "./marker";
import { libraryPath } from "@library/lib/paths";

/** Page frame of the `/admin/*` screens: back link, page header, optional intro. */
export function AdminPage({
  title,
  intro,
  children,
  wide = false,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useDocumentTitle(title);
  return (
    <div data-elib-admin={ADMIN_BUNDLE_MARKER}>
      <Container className="pb-16">
        <div className={cn("mx-auto w-full", wide ? "max-w-5xl" : "max-w-3xl")}>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mt-6 -ml-2 text-muted-foreground sm:mt-8"
          >
            <Link to={libraryPath()}>
              <ArrowLeftIcon />
              Biblioteca
            </Link>
          </Button>
          <PageHeader
            eyebrow="Libreria"
            title={title}
            description={intro}
            className="pt-4 pb-0 sm:pt-5"
          />
          <div className="mt-8">{children}</div>
        </div>
      </Container>
    </div>
  );
}
