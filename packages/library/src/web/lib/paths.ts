/**
 * In-app URLs. The library is mounted by the shell under `LIBRARY_BASE`, so every absolute navigation goes
 * through `libraryPath`. Defined here (not in entry.tsx) to avoid an import cycle; entry.tsx re-exports it.
 */
export const LIBRARY_BASE = "/library";

/**
 * `libraryPath()` → `/library`; `libraryPath("book/x")` or `libraryPath("/book/x")` → `/library/book/x`;
 * `libraryPath("?topic=a")` → `/library?topic=a`.
 */
export function libraryPath(sub = ""): string {
  if (sub === "") return LIBRARY_BASE;
  if (sub.startsWith("?") || sub.startsWith("#")) return `${LIBRARY_BASE}${sub}`;
  return `${LIBRARY_BASE}/${sub.replace(/^\/+/, "")}`;
}
