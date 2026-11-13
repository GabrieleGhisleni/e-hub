/**
 * Explorations write server for the Vite dev server (mounted by vite.config.ts; never in the production build).
 * Reads and writes the files under packages/explore/data through the repo, so every write is schema-checked.
 */
import { createExploreApp } from "@ehub/explore/server";

export default createExploreApp();
