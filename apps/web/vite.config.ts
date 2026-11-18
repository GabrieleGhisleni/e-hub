import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadConfig } from "@ehub/library/config";
import { elibData } from "@ehub/library/vite";
import { exploreData } from "@ehub/explore/vite";
import { notesData } from "@ehub/notes/vite";
import { staticPages } from "@ehub/podcasts/vite";

const repo = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/**
 * Hosted build (`VITE_HOSTED=1`, docs/hosting.md): the site is only code, data comes from the API at runtime and the
 * admin controls appear after the Google login. The admin gates (`__ELIB_ADMIN__`, `import.meta.env.DEV`) become one
 * runtime flag, set at startup by src/session.ts before any module reads it.
 */
const HOSTED = process.env.VITE_HOSTED === "1";
const ADMIN_FLAG = "(globalThis.__EHUB_ADMIN__ === true)";

export default defineConfig(({ command }) => {
  const libraryConfig = loadConfig();
  return {
    // Single app served at the root by default; GitHub Pages project sites set BASE_PATH=/<repo>/.
    base: process.env.BASE_PATH ?? "/",
    plugins: HOSTED
      ? [
          react(),
          tailwindcss(),
          {
            // GitHub Pages serves 404.html for unknown paths: the same shell, so deep links reach the SPA router.
            name: "ehub-spa-404",
            generateBundle: {
              order: "post",
              handler(_options, bundle) {
                const html = bundle["index.html"];
                if (html?.type === "asset") {
                  this.emitFile({ type: "asset", fileName: "404.html", source: html.source });
                }
              },
            },
          },
        ]
      : [
      react(),
      tailwindcss(),
      // Library site data: dev serves + watches data/; build validates, emits data files + 404.html.
      elibData({ dataDir: libraryConfig.dataDir }),
      // Podcasts build only: static episode pages (dist/episode/<slug>/index.html).
      staticPages({ dataDir: repo("podcasts/data"), urlPrefix: "podcasts" }),
      // Notes build guard: every packages/notes/data file must be valid, or the build fails.
      notesData(),
      // Explorations build guard: every packages/explore/data file must be valid, or the build fails.
      exploreData(),
      // Podcasts local write server (Hono): dev only, never part of the production build.
      // Hono handles only /api/podcasts/*; everything else is served by Vite.
      ...(command === "serve"
        ? [
            devServer({
              entry: "@ehub/podcasts/server",
              exclude: [/^(?!\/api\/podcasts\/).*/],
              injectClientScript: false,
            }),
            // Notes local write server (Hono): /api/notes and /api/notes/* only.
            devServer({
              entry: "./server/notes-dev.ts",
              exclude: [/^(?!\/api\/notes(\/|\?|$)).*/],
              injectClientScript: false,
            }),
            // Explorations local write server (Hono): /api/explore and /api/explore/* only.
            devServer({
              entry: "./server/explore-dev.ts",
              exclude: [/^(?!\/api\/explore(\/|\?|$)).*/],
              injectClientScript: false,
            }),
            // Chat local server (Hono): /api/chat only, streams the LLM reply. LLM config from .env.local.
            devServer({
              entry: "./server/chat-dev.ts",
              exclude: [/^(?!\/api\/chat(\/|\?|$)).*/],
              injectClientScript: false,
            }),
          ]
        : []),
      ],
    resolve: {
      alias: {
        "@library": repo("library/src/web"),
        "@podcasts": repo("podcasts/src/web"),
        "@shared": repo("library/src/shared"),
        "@core": repo("podcasts/src/core"),
      },
    },
    define: HOSTED
      ? { __ELIB_ADMIN__: ADMIN_FLAG, "import.meta.env.DEV": ADMIN_FLAG }
      : {
          // Admin controls exist only in the local dev UI; the static build is read-only.
          __ELIB_ADMIN__: JSON.stringify(command === "serve"),
        },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      watch: {
        // In dev explorations and notes go through /api/explore and /api/notes; the globs in src/explore-data.ts and
        // src/notes-data.ts are for the build only. Watching the files would reload the page on every write (e.g.
        // halfway through saving a proposal, or when the chat saves a note), closing the chat.
        ignored: ["**/packages/explore/data/**", "**/packages/notes/data/**"],
      },
      proxy: {
        // The library node server runs separately (`pnpm dev` starts it alongside Vite).
        "/api/library": { target: `http://127.0.0.1:${libraryConfig.server.port}`, changeOrigin: false },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});
