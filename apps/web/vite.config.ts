import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repo = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/**
 * The site is only code: data comes from the API at runtime (docs/hosting.md) and the admin controls appear after the
 * login. The admin gates (`__ELIB_ADMIN__`, `import.meta.env.DEV`) are one runtime flag, set at startup by
 * src/session.ts before any module reads it.
 *
 * `pnpm dev` runs the API on this machine (apps/api, against the real Turso/R2 from .env.local) and Vite proxies
 * `/api` and `/auth` to it; the page logs in by itself as the owner (VITE_DEV_LOGIN, loopback only).
 */
const ADMIN_FLAG = "(globalThis.__EHUB_ADMIN__ === true)";
const API_PORT = Number(process.env.PORT ?? 8788);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  // Single app served at the root by default; set BASE_PATH for a project site (`/<repo>/`).
  base: process.env.BASE_PATH ?? "/",
  plugins: [
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
  ],
  resolve: {
    alias: {
      "@library": repo("library/src/web"),
      "@podcasts": repo("podcasts/src/web"),
      "@shared": repo("library/src/shared"),
      "@core": repo("podcasts/src/core"),
    },
  },
  define: { __ELIB_ADMIN__: ADMIN_FLAG, "import.meta.env.DEV": ADMIN_FLAG },
  server: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      "/auth": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
