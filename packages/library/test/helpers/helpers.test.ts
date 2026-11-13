import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/node/config/index.ts";
import { readTopics } from "../../src/node/repo/index.ts";
import { hasBinary } from "./binaries.ts";
import { buildEpub, makeEpub } from "./epub.ts";
import { createTestEnv } from "./test-env.ts";

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

describe("makeEpub", () => {
  it("writes a zip whose first entry is an uncompressed `mimetype`", async () => {
    const file = await makeEpub();
    const bytes = new Uint8Array(await readFile(file));
    // Local file header of the first entry.
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(u16(bytes, 8)).toBe(0); // compression method: stored
    const nameLength = u16(bytes, 26);
    const extraLength = u16(bytes, 28);
    expect(strFromU8(bytes.subarray(30, 30 + nameLength))).toBe("mimetype");
    expect(extraLength).toBe(0);
    const start = 30 + nameLength + extraLength;
    expect(strFromU8(bytes.subarray(start, start + 20))).toBe("application/epub+zip");
  });

  it("contains container, OPF, nav, NCX, chapters and a real cover image", async () => {
    const files = unzipSync(await buildEpub());
    expect(Object.keys(files)).toEqual([
      "mimetype",
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/toc.ncx",
      "OEBPS/text/chapter-1.xhtml",
      "OEBPS/text/chapter-2.xhtml",
      "OEBPS/text/chapter-3.xhtml",
      "OEBPS/images/cover.png",
    ]);
    const opf = strFromU8(files["OEBPS/content.opf"] ?? new Uint8Array());
    expect(opf).toContain('version="3.0"');
    expect(opf).toContain("<dc:title>Il giardino delle prove</dc:title>");
    expect(opf).toContain("urn:isbn:9788800000000");
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    expect(strFromU8(files["OEBPS/text/chapter-1.xhtml"] ?? new Uint8Array())).toContain(
      "<h1>Capitolo primo</h1>",
    );
    const meta = await sharp(files["OEBPS/images/cover.png"]).metadata();
    expect(meta).toMatchObject({ format: "png", width: 300, height: 450 });
  });

  it("supports EPUB2-style metadata and omitted fields", async () => {
    const files = unzipSync(
      await buildEpub({
        version: "2.0",
        title: null,
        isbn: "9788800000002",
        isbnStyle: "plain",
        creators: [{ name: "Ada Esempio", fileAs: "Esempio, Ada" }],
        publisher: null,
        description: null,
        cover: { format: "jpeg", marking: "meta" },
      }),
    );
    expect(files["OEBPS/nav.xhtml"]).toBeUndefined();
    const opf = strFromU8(files["OEBPS/content.opf"] ?? new Uint8Array());
    expect(opf).toContain('version="2.0"');
    expect(opf).not.toContain("<dc:title>");
    expect(opf).toContain('<dc:identifier opf:scheme="ISBN">9788800000002</dc:identifier>');
    expect(opf).toContain('opf:file-as="Esempio, Ada"');
    expect(opf).not.toContain("properties=");
    expect(opf).not.toContain("dc:publisher");
    expect(files["OEBPS/images/cover.jpg"]).toBeDefined();

    const bare = unzipSync(
      await buildEpub({ cover: false, isbn: null, creators: [], subjects: [] }),
    );
    const bareOpf = strFromU8(bare["OEBPS/content.opf"] ?? new Uint8Array());
    expect(Object.keys(bare).some((k) => k.includes("cover"))).toBe(false);
    expect(bareOpf).not.toContain("isbn");
    expect(bareOpf).not.toContain("dc:creator");
  });
});

describe("hasBinary", () => {
  it("finds node and not a made-up binary", () => {
    expect(hasBinary("node")).toBe(true);
    expect(hasBinary("definitely-not-a-binary-elib")).toBe(false);
  });
});

describe("createTestEnv", () => {
  it("gives loadConfig an isolated config, data dir and cache", async () => {
    const env = await createTestEnv();
    try {
      const config = loadConfig({ env: env.env });
      expect(config.kobo.booksDir).toBe("/mnt/onboard/books");
      expect(config.kobo.host).toBe("root@127.0.0.1");
      expect(config.dataDir).toBe(env.dataDir);
      expect(config.cache.dir).toBe(env.cacheDir);
      expect((await readTopics(env.dataDir))[0]?.id).toBe("unsorted");
    } finally {
      await env.cleanup();
    }
  });
});
