import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loadConfig } from "./src/node/config/index.ts";
import { elibData } from "./src/node/vite/index.ts";

export default defineConfig(({ command }) => {
  const config = loadConfig();
  return {
    base: config.site.basePath,
    plugins: [
      react(),
      tailwindcss(),
      // Site data: dev serves + watches data/ (HMR event `elib:data-changed`); build validates, emits data files + 404.html.
      elibData({ dataDir: config.dataDir }),
    ],
    resolve: {
      alias: {
        "@library": path.resolve(config.repoRoot, "src/web"),
        "@shared": path.resolve(config.repoRoot, "src/shared"),
      },
    },
    define: {
      // Admin controls exist only in the local dev UI; the Pages build is read-only (PLAN §3).
      __ELIB_ADMIN__: JSON.stringify(command === "serve"),
    },
    build: {
      // Vendor chunks (stable names/content across app-only deploys) so a visitor re-downloads only the app chunk.
      // Largest chunk is react-dom (~200 kB min); above 250 kB something unexpected landed in a chunk.
      chunkSizeWarningLimit: 250,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "vendor-react",
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: "vendor-router",
                test: /node_modules[\\/](?:react-router|@remix-run|cookie|set-cookie-parser)[\\/]/,
                priority: 20,
              },
              {
                name: "vendor-ui",
                test: /node_modules[\\/](?:@radix-ui[\\/]react-(?:slot|compose-refs)|tailwind-merge|class-variance-authority|clsx)[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api/library": { target: `http://127.0.0.1:${config.server.port}`, changeOrigin: false },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});
