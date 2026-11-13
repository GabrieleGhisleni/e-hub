import { createContext, type ReactNode, useContext } from "react";

/** What a page is about, as far as other modules (e.g. explorations) are concerned. */
export interface SourceExtraRef {
  kind: "book" | "episode";
  id: string;
}

type RenderSourceExtras = (ref: SourceExtraRef) => ReactNode;

const SourceExtrasContext = createContext<RenderSourceExtras | null>(null);

/**
 * Lets the app plug extra content into library and podcast pages without those modules importing each other:
 * the library renders `<SourceExtras kind="book" id=… />`, and the app decides what that shows (e.g. the
 * explorations a book appears in). Without a provider, `SourceExtras` renders nothing.
 */
export function SourceExtrasProvider({
  render,
  children,
}: {
  render: RenderSourceExtras;
  children?: ReactNode;
}) {
  return <SourceExtrasContext.Provider value={render}>{children}</SourceExtrasContext.Provider>;
}

/** The extra content for one book or episode, as given by the nearest `SourceExtrasProvider`. */
export function SourceExtras({ kind, id }: SourceExtraRef) {
  const render = useContext(SourceExtrasContext);
  if (!render) return null;
  const content = render({ kind, id });
  return content ? <>{content}</> : null;
}
