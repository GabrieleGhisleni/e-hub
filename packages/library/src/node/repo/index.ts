/**
 * Repo store: the only code that reads and writes data/ (topics.json and data/books/<id>/).
 * Every function takes the data dir explicitly, so tests can point it at a temp dir.
 */
export * from "./books.ts";
export * from "./errors.ts";
export { formatJson, readTextIfExists, writeFileAtomic } from "./fs.ts";
export * from "./paths.ts";
export * from "./highlights.ts";
export * from "./summary.ts";
export * from "./topics.ts";
