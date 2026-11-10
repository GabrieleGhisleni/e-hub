import { useMemo } from "react";
import { useSiteIndex } from "@library/data/site-data";
import { collectTags } from "./lib/tags";

/** Topics and tags in use, from the public index (kept fresh by `refreshSiteData()` after writes). */
export function useAdminIndexData() {
  const index = useSiteIndex();
  const allTags = useMemo(() => collectTags(index.data?.books ?? []), [index.data]);
  return { index, topics: index.data?.topics ?? [], allTags };
}
