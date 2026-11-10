/** Shared setup for the services / server / CLI integration tests: test env + service context + fakes. */
import { accessSync, constants } from "node:fs";
import { chmod, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { type LoadedConfig, loadConfig } from "../../../src/node/config/index.ts";
import { readTopics } from "../../../src/node/repo/index.ts";
import {
  type ServiceContext,
  type ServiceContextOptions,
  createServiceContext,
  silentLogger,
} from "../../../src/node/services/index.ts";
import { type DrivePaths, expectedDrivePaths } from "../../../src/shared/paths.ts";
import type { Book } from "../../../src/shared/schema.ts";
import { type TestEnv, createTestEnv } from "../../helpers/test-env.ts";

export const OL_COVER_ID = 4242;
export const OL_ISBN = "9788800000000";

/** No network: every request is a 404. */
export const offlineFetch: typeof fetch = async () => new Response("not found", { status: 404 });

/** A JPEG above Open Library's 1 KB "no cover" threshold (noise does not compress). */
export async function noisyJpeg(width = 200, height = 300): Promise<Uint8Array> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#808080",
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Uint8Array(bytes);
}

/** Fake Open Library: the ISBN lookup finds cover `OL_COVER_ID`, whose image is a noisy JPEG. */
export async function openLibraryFetch(): Promise<{ fetch: typeof fetch; urls: string[] }> {
  const jpeg = await noisyJpeg();
  const urls: string[] = [];
  const fake: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url === `https://openlibrary.org/isbn/${OL_ISBN}.json`) {
      return Response.json({ title: "Il giardino delle prove (OL)", covers: [OL_COVER_ID] });
    }
    if (url.startsWith(`https://covers.openlibrary.org/b/id/${OL_COVER_ID}-L.jpg`)) {
      return new Response(jpeg as Uint8Array<ArrayBuffer>, {
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fake, urls };
}

export interface ServicesTestEnv {
  env: TestEnv;
  config: LoadedConfig;
  ctx: ServiceContext;
  /** Another service context on the same dirs/remote (e.g. with a different rclone binary). */
  makeCtx(options?: ServiceContextOptions): ServiceContext;
  /** Every file under the remote root (sorted remote paths). */
  remoteFiles(): Promise<string[]>;
  remoteDirs(): Promise<string[]>;
  expected(book: Book): Promise<DrivePaths>;
  cleanup(): Promise<void>;
}

export async function setupServices(options: ServiceContextOptions = {}): Promise<ServicesTestEnv> {
  const env = await createTestEnv();
  const config = loadConfig({ env: env.env });
  const makeCtx = (extra: ServiceContextOptions = {}) =>
    createServiceContext(config, {
      env: env.env,
      fetch: offlineFetch,
      logger: silentLogger,
      ...options,
      ...extra,
    });
  const walk = async (wantDirs: boolean): Promise<string[]> => {
    const out: string[] = [];
    const visit = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (wantDirs) out.push(r);
          await visit(path.join(dir, e.name), r);
        } else if (!wantDirs) {
          out.push(r);
        }
      }
    };
    await visit(env.remote.dir, "");
    return out.sort();
  };
  return {
    env,
    config,
    ctx: makeCtx(),
    makeCtx,
    remoteFiles: () => walk(false),
    remoteDirs: () => walk(true),
    expected: async (book) => expectedDrivePaths(book, await readTopics(env.dataDir), config.drive),
    cleanup: env.cleanup,
  };
}

/** Absolute path of `name` on PATH. */
export function whichBinary(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // next
    }
  }
  throw new Error(`${name} not found on PATH`);
}

/**
 * An rclone wrapper (shell script in `dir`) that fails every `copyto` of a `.kepub.epub` and runs the real rclone
 * otherwise: uploads stop half-way (EPUB on Drive, KEPUB not).
 */
export async function failingKepubRclone(dir: string, realRclone: string): Promise<string> {
  const script = path.join(dir, "rclone-fail-kepub.sh");
  await writeFile(
    script,
    `#!/bin/sh
if [ "$1" = "copyto" ]; then
  for arg in "$@"; do
    case "$arg" in *.kepub.epub) echo "simulated failure" >&2; exit 1;; esac
  done
fi
exec "${realRclone}" "$@"
`,
  );
  await chmod(script, 0o755);
  return script;
}
