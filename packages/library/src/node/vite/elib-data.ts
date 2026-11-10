import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import {
  BOOKS_PATH_PREFIX,
  COVERS_PATH_PREFIX,
  DATA_CHANGED_EVENT,
  INDEX_PATH,
  bookPath,
  coverPath,
  normalizeBasePath,
} from "../../shared/site-urls.ts";
import { loadConfig } from "../config/index.ts";
import { type SiteData, buildSiteData } from "../site-data/build.ts";
import { validateData } from "../site-data/validate.ts";

export interface ElibDataOptions {
  /** Defaults to `loadConfig().dataDir` (honours `ELIB_DATA_DIR`). */
  dataDir?: string;
  /** Defaults to Vite's resolved `base`. */
  basePath?: string;
}

const JSON_TYPE = "application/json; charset=utf-8";

/**
 * Serves (dev) and emits (build) the generated site data: `data/index.json`, `data/books/<id>.json`,
 * `data/covers/<id>.<hash>.webp`. Build also validates data/ and writes `404.html` (copy of `index.html`).
 */
export function elibData(options: ElibDataOptions = {}): Plugin {
  const dataDir = path.resolve(options.dataDir ?? loadConfig().dataDir);
  let basePath = normalizeBasePath(options.basePath ?? "/");
  let resolved: ResolvedConfig | undefined;
  let cache: Promise<SiteData> | null = null;
  let builtData: SiteData | null = null;

  const load = (): Promise<SiteData> => {
    cache ??= buildSiteData(dataDir, { basePath });
    return cache;
  };

  function configureDev(server: ViteDevServer): void {
    let timer: NodeJS.Timeout | undefined;
    const onChange = (file: string) => {
      const rel = path.relative(dataDir, file);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return;
      cache = null;
      clearTimeout(timer);
      timer = setTimeout(() => server.ws.send({ type: "custom", event: DATA_CHANGED_EVENT }), 100);
    };
    server.watcher.add(dataDir);
    for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"] as const) {
      server.watcher.on(event, onChange);
    }

    let warned = "";
    server.middlewares.use(async (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      let pathname: string;
      try {
        pathname = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
      } catch {
        return next(); // malformed escape (e.g. `%E0%A4%A`): not ours, never crash the dev server
      }
      if (!pathname.startsWith(`${basePath}data/`)) return next();
      const rel = pathname.slice(basePath.length);
      try {
        const data = await load();
        const warnings = data.problems.map((p) => `${p.id ?? "data"}: ${p.message}`).join("\n");
        if (warnings && warnings !== warned) {
          warned = warnings;
          server.config.logger.warn(`[elib-data] skipped books:\n${warnings}`);
        }
        res.setHeader("Cache-Control", "no-cache");
        const sendJson = (value: unknown) => {
          res.setHeader("Content-Type", JSON_TYPE);
          res.end(req.method === "HEAD" ? undefined : JSON.stringify(value));
        };
        if (rel === INDEX_PATH) return sendJson(data.index);
        if (rel.startsWith(BOOKS_PATH_PREFIX) && rel.endsWith(".json")) {
          const detail = data.details.get(rel.slice(BOOKS_PATH_PREFIX.length, -".json".length));
          if (detail) return sendJson(detail);
        } else if (rel.startsWith(COVERS_PATH_PREFIX)) {
          const source = data.covers.get(rel.slice(COVERS_PATH_PREFIX.length));
          if (source) {
            res.setHeader("Content-Type", "image/webp");
            if (req.method === "HEAD") return void res.end();
            const stream = createReadStream(source);
            stream.on("error", () => res.end());
            return void stream.pipe(res);
          }
        }
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found");
      } catch (error) {
        server.config.logger.error(`[elib-data] ${(error as Error).message}`);
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end((error as Error).message);
      }
    });
  }

  return {
    name: "elib-data",

    configResolved(config) {
      resolved = config;
      if (options.basePath === undefined) basePath = normalizeBasePath(config.base);
    },

    configureServer: {
      handler(server) {
        configureDev(server);
      },
    },

    async buildStart() {
      if (resolved?.command !== "build") return;
      const { errors, warnings } = await validateData(dataDir);
      for (const w of warnings) this.warn(`${w.path ?? "data"}: ${w.message}`);
      if (errors.length > 0) {
        this.error(
          `data validation failed:\n${errors.map((e) => `  ${e.path ?? "data"}: ${e.message}`).join("\n")}`,
        );
      }
      builtData = await buildSiteData(dataDir, { basePath });
      for (const p of builtData.problems) this.warn(`${p.id ?? "data"}: ${p.message}`);
    },

    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        if (resolved?.command !== "build" || !builtData) return;
        const data = builtData;
        const json = (value: unknown) => `${JSON.stringify(value)}\n`;
        this.emitFile({ type: "asset", fileName: INDEX_PATH, source: json(data.index) });
        for (const [id, detail] of data.details) {
          this.emitFile({ type: "asset", fileName: bookPath(id), source: json(detail) });
        }
        for (const [fileName, source] of data.covers) {
          this.emitFile({
            type: "asset",
            fileName: coverPath(fileName),
            source: await readFile(source),
          });
        }
        const html = bundle["index.html"];
        if (html?.type === "asset") {
          this.emitFile({ type: "asset", fileName: "404.html", source: html.source });
        } else {
          this.warn("index.html not found in the bundle: 404.html not emitted");
        }
      },
    },
  };
}
