/**
 * Build guard (Vite plugin): validates every exploration file before the site is built, so an invalid or
 * hand-broken file fails `pnpm build` instead of being published (or silently dropped by the client).
 */
import type { Plugin } from "vite";
import { checkExplorations, exploreDataDir } from "./store.ts";

export function exploreData(): Plugin {
  return {
    name: "ehub-explore-data",
    apply: "build",
    async buildStart() {
      const { valid, problems } = await checkExplorations();
      if (problems.length > 0) {
        const lines = problems.flatMap((p) => [
          `${p.message}`,
          ...p.details.map((d) => `  - ${d}`),
        ]);
        this.error(`explore: file non validi in ${exploreDataDir()}\n${lines.join("\n")}`);
      }
      this.info(`explore: ${valid} esplorazione/i valide in ${exploreDataDir()}`);
    },
  };
}
