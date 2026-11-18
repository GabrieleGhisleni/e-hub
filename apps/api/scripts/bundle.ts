/**
 * Bundles the API into one file (`apps/api/dist/ehub-api.mjs`) so the Raspberry Pi needs no `pnpm install`.
 * `sharp` is native and cannot be bundled: it stays external and `deploy/pi/deploy.sh` ships its linux-arm64 build.
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src/main.ts")],
  outfile: path.join(root, "dist/ehub-api.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["sharp"],
  // CommonJS dependencies of the bundle need require().
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
