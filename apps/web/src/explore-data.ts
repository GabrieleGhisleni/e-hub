/**
 * Explorations store for the running app:
 * - dev: the local explorations API (/api/explore, files in packages/explore/data, editable);
 * - build: the exploration files bundled at build time, read-only (the build already validated them).
 */
import { HOSTED } from "./session";
import { createHttpExploreStore, createStaticExploreStore, type ExploreStore } from "@ehub/explore";

export function createAppExploreStore(): ExploreStore {
  if (HOSTED || import.meta.env.DEV) return createHttpExploreStore();
  const files = import.meta.glob("../../../packages/explore/data/*.json", {
    eager: true,
    import: "default",
  });
  return createStaticExploreStore(Object.values(files));
}
