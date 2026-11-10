/**
 * Tag statistics for `pnpm tags` and the tag editor/filter. Pure and isomorphic.
 */

export interface TagCount {
  tag: string;
  count: number;
}

/** Tags with the number of episodes using them, most used first (ties alphabetical). */
export function countTags(episodes: readonly { tags: readonly string[] }[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    for (const tag of new Set(episode.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
