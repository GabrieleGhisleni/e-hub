import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  type LibraryQuery,
  parseLibraryQuery,
  serializeLibraryQuery,
} from "@library/lib/library-query";

export interface SetLibraryQueryOptions {
  /** Replace the history entry instead of pushing one (used while typing in the search box). */
  replace?: boolean;
}

/** Search + filters + sort, stored in the URL query string (shareable links, back button). */
export function useLibraryQuery(): [
  LibraryQuery,
  (next: LibraryQuery, options?: SetLibraryQueryOptions) => void,
] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseLibraryQuery(params), [params]);
  const setQuery = useCallback(
    (next: LibraryQuery, options: SetLibraryQueryOptions = {}) => {
      setParams(serializeLibraryQuery(next), {
        replace: options.replace ?? false,
        // Changing a filter keeps the scroll position (ScrollRestoration would jump to the top).
        preventScrollReset: true,
      });
    },
    [setParams],
  );
  return [query, setQuery];
}
