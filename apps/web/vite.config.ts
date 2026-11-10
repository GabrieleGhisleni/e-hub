import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadConfig } from "@ehub/library/config";
import { elibData } from "@ehub/library/vite";
import { notesData } from "@ehub/notes/vite";
import { staticPages } from "@ehub/podcasts/vite";

const repo = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

export default defineConfig(({ command }) => {
  const libraryConfig = loadConfig();
  return {
    // Single app served at the root by default; GitHub Pages project sites set BASE_PATH=/<repo>/.
    base: process.env.BASE_PATH ?? "/",
    plugins: [
      react(),
      tailwindcss(),
      // Library site data: dev serves + watches data/; build validates, emits data files + 404.html.
      elibData({ dataDir: libraryConfig.dataDir }),
      // Podcasts build only: static episode pages (dist/episode/<slug>/index.html).
      staticPages({ dataDir: repo("podcasts/data"), urlPrefix: "podcasts" }),
      // Notes build guard: every packages/notes/data file must be valid, or the build fails.
      notesData(),
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
    define: {
      // Admin controls exist only in the local dev UI; the static build is read-only.
      __ELIB_ADMIN__: JSON.stringify(command === "serve"),
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
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
