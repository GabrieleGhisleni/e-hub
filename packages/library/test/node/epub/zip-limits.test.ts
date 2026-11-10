import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EpubError, extractEpubMetadata } from "../../../src/node/epub/index.ts";
import { ZIP_LIMITS, ZipError, openCappedZip } from "../../../src/node/epub/zip.ts";
import { EpubTextError, readEpubStructure } from "../../../src/node/text/structure.ts";
import { buildEpub } from "../../helpers/index.ts";

/** A small zip whose `name` entry declares (and inflates to) `size` zero bytes: built here, never committed. */
function bomb(name: string, size: number, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const zeros = new Uint8Array(size);
  return zipSync({ [name]: [zeros, { level: 9 }], ...extra }, { mtime: new Date("2026-01-01") });
}

const OVER_TEXT = ZIP_LIMITS.maxTextEntryBytes + 1024;

describe("zip size caps (R1-04)", () => {
  it("a tiny zip declaring a huge container.xml is an EpubError, not a crash", async () => {
    const zip = bomb("META-INF/container.xml", OVER_TEXT);
    expect(zip.length).toBeLessThan(100_000);
    const error = await extractEpubMetadata(zip).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EpubError);
    expect((error as Error).message).toMatch(/too large/);
  });

  it("an oversized entry anywhere in a valid EPUB is refused (images have a larger cap)", async () => {
    const epub = await buildEpub();
    const { unzipSync } = await import("fflate");
    const files = { ...unzipSync(epub) };
    files["OEBPS/text/huge.xhtml"] = new Uint8Array(OVER_TEXT);
    await expect(extractEpubMetadata(zipSync(files))).rejects.toBeInstanceOf(EpubError);

    const withBigImage = { ...unzipSync(epub), "OEBPS/images/big.png": new Uint8Array(OVER_TEXT) };
    await expect(extractEpubMetadata(zipSync(withBigImage))).resolves.toMatchObject({
      title: "Il giardino delle prove",
    });
  });

  it("the total declared size and the entry count are capped", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 4; i++) files[`img${i}.png`] = new Uint8Array(1024 * 1024);
    const zip = zipSync(files);
    expect(() => openCappedZip(zip, { maxTotalBytes: 3 * 1024 * 1024 })).toThrow(ZipError);
    expect(() => openCappedZip(zip, { maxEntries: 3 })).toThrow(/entries/);
    expect(openCappedZip(zip).names).toHaveLength(4);
  });

  it("a non-EpubError thrown while parsing becomes an EpubError", async () => {
    // Not a zip at all, and a zip with garbage where the OPF should be.
    await expect(extractEpubMetadata(strToU8("not a zip"))).rejects.toBeInstanceOf(EpubError);
    const weird = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>',
      ),
      "a.opf": strToU8("<package><metadata><dc:title>x</dc:title></metadata></package>"),
    });
    await expect(extractEpubMetadata(weird)).resolves.toBeDefined();
  });

  it("readEpubStructure uses the same capped reader", () => {
    const zip = bomb("META-INF/container.xml", OVER_TEXT);
    expect(() => readEpubStructure(zip)).toThrow(EpubTextError);
    expect(() => readEpubStructure(zip)).toThrow(/too large/);
  });
});
