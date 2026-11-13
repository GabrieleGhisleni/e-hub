/** Shared setup for the services / server / CLI integration tests: test env + service context + fakes. */
import { accessSync, constants } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { type LoadedConfig, loadConfig } from "../../../src/node/config/index.ts";
import { type KoboTransport, localTransport } from "../../../src/node/kobo/index.ts";
import {
  type ServiceContext,
  type ServiceContextOptions,
  createServiceContext,
  silentLogger,
} from "../../../src/node/services/index.ts";
import { koboFileName } from "../../../src/shared/naming.ts";
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

/** A Kobo that is off or not on the Wi-Fi: every listing fails (the report gets `listing-failed`). */
export function offlineKoboTransport(koboDir: string): KoboTransport {
  return {
    ...localTransport(koboDir),
    list: async () => {
      throw new Error("ssh: connect to host 192.168.1.11 port 2222: Connection timed out");
    },
  };
}

export interface ServicesTestEnv {
  env: TestEnv;
  config: LoadedConfig;
  ctx: ServiceContext;
  /** Another service context on the same dirs and Kobo folder (e.g. with another transport). */
  makeCtx(options?: ServiceContextOptions): ServiceContext;
  /** Every file under the Kobo folder (sorted, "/"-separated, sidecar metadata included). */
  remoteFiles(): Promise<string[]>;
  /** Names directly inside the Kobo folder (KEPUBs and `.kepub.sdr` folders), sorted. */
  koboNames(): Promise<string[]>;
  /** Content of `custom_metadata.lua` of a book on the Kobo (null when missing). */
  koboMetadata(book: Pick<Book, "title" | "authors" | "id">): Promise<string | null>;
  cleanup(): Promise<void>;
}

export async function setupServices(options: ServiceContextOptions = {}): Promise<ServicesTestEnv> {
  const env = await createTestEnv();
  const config = loadConfig({ env: env.env });
  const makeCtx = (extra: ServiceContextOptions = {}) =>
    createServiceContext(config, {
      // The test folders on top of the real env: kepubify still needs PATH.
      env: { ...process.env, ...env.env },
      fetch: offlineFetch,
      logger: silentLogger,
      transport: localTransport(env.koboDir),
      ...options,
      ...extra,
    });
  const walk = async (): Promise<string[]> => {
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
        if (e.isDirectory()) await visit(path.join(dir, e.name), r);
        else out.push(r);
      }
    };
    await visit(env.koboDir, "");
    return out.sort();
  };
  return {
    env,
    config,
    ctx: makeCtx(),
    makeCtx,
    remoteFiles: walk,
    koboNames: async () => (await readdir(env.koboDir)).sort(),
    koboMetadata: async (book) => {
      const file = path.join(env.koboDir, koboFileName(book, "sidecar"), "custom_metadata.lua");
      try {
        return await readFile(file, "utf8");
      } catch {
        return null;
      }
    },
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
