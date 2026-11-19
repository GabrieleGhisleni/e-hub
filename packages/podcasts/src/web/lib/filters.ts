/**
 * Home filters <-> URL search params, so filtered views are shareable links:
 * `?q=<query>&show=<slug>&show=<slug>&tag=<tag>&tag=<tag>&month=<month>`.
 */

export interface Filters {
  /** Raw query as typed (not trimmed, so the input keeps trailing spaces). */
  readonly q: string;
  /** Show slugs; an episode matches if its show is any of them. */
  readonly shows: readonly string[];
  /** Tags; an episode matches if it has all of them. */
  readonly tags: readonly string[];
  readonly month?: string;
}

export const EMPTY_FILTERS: Filters = { q: "", shows: [], tags: [] };

const unique = (values: readonly string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

export function parseFilters(params: URLSearchParams): Filters {
  const month = params.get("month");
  return {
    q: params.get("q") ?? "",
    shows: unique(params.getAll("show")),
    tags: unique(params.getAll("tag")),
    ...(month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { month } : {}),
  };
}

export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim() !== "") params.set("q", filters.q);
  for (const show of filters.shows) params.append("show", show);
  for (const tag of filters.tags) params.append("tag", tag);
  if (filters.month) params.set("month", filters.month);
  return params;
}

/** `?…` string for links (empty string when no filter is set). */
export function filtersToSearch(filters: Filters): string {
  const search = filtersToParams(filters).toString();
  return search ? `?${search}` : "";
}

export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.q.trim() !== "" || filters.shows.length > 0 || filters.tags.length > 0 || Boolean(filters.month);
}
