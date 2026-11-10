import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildEpub, makeEpub } from "../../helpers/index.ts";
import { EpubError, extractEpubMetadata, normalizeIsbn } from "../../../src/node/epub/index.ts";

// The helper default ISBN (9788800000000) is valid; these tests still pass explicit ISBNs to stay self-describing.
const VALID_ISBN = "9780306406157";

describe("extractEpubMetadata", () => {
  it("reads EPUB 3 metadata with refines roles", async () => {
    const meta = await extractEpubMetadata(await buildEpub({ isbn: VALID_ISBN }));
    expect(meta.title).toBe("Il giardino delle prove");
    expect(meta.authors).toEqual(["Ada Esempio", "Bruno Campione"]);
    expect(meta.subjects).toEqual(["Narrativa", "Test"]);
    expect(meta.isbn).toBe(VALID_ISBN);
    expect(meta.language).toBe("it");
    expect(meta.publisher).toBe("Editore di Prova");
    expect(meta.description).toBe("Un libro sintetico generato per i test.");
    expect(meta.cover?.mediaType).toBe("image/png");
  });

  it("reads EPUB 2 metadata with opf:role and opf:scheme", async () => {
    const meta = await extractEpubMetadata(
      await buildEpub({
        version: "2.0",
        creators: [
          { name: "Ada Esempio", role: "aut" },
          { name: "Tina Traduttrice", role: "trl" },
        ],
        isbn: VALID_ISBN,
        isbnStyle: "plain",
      }),
    );
    expect(meta.authors).toEqual(["Ada Esempio"]);
    expect(meta.isbn).toBe(VALID_ISBN);
    expect(meta.cover).toBeDefined();
  });

  it("filters out non-author roles in EPUB 3", async () => {
    const meta = await extractEpubMetadata(
      await buildEpub({
        creators: [
          { name: "Ada", role: "aut" },
          { name: "Ed Itor", role: "edt" },
        ],
      }),
    );
    expect(meta.authors).toEqual(["Ada"]);
  });

  it("keeps all creators when none has a role and normalizes Last, First", async () => {
    const meta = await extractEpubMetadata(
      await buildEpub({
        creators: [],
        extraMetadataXml:
          "<dc:creator>Clear, James</dc:creator><dc:creator>Tolkien, J.R.R., Jr.</dc:creator><dc:creator>clear, james</dc:creator><dc:creator>  Bob   Smith </dc:creator>",
      }),
    );
    expect(meta.authors).toEqual(["James Clear", "Tolkien, J.R.R., Jr.", "Bob Smith"]);
  });

  it("converts ISBN-10 to ISBN-13 and ignores invalid ISBNs", async () => {
    expect((await extractEpubMetadata(await buildEpub({ isbn: "0306406152" }))).isbn).toBe(
      "9780306406157",
    );
    const bad = await extractEpubMetadata(await buildEpub({ isbn: "9788800000002" }));
    expect(bad.isbn).toBeUndefined();
    expect(bad.warnings.some((w) => /ISBN/.test(w))).toBe(true);
    expect(normalizeIsbn("urn:isbn:978-0-306-40615-7")).toBe("9780306406157");
    expect(normalizeIsbn("080442957X")).toBe("9780804429573");
  });

  it("strips HTML and decodes entities in descriptions", async () => {
    const meta = await extractEpubMetadata(
      await buildEpub({
        description: "<p>Tom &amp; Jerry</p>\n\n<p>second   <b>line</b>&nbsp;here &#233;</p>",
      }),
    );
    expect(meta.description).toBe("Tom & Jerry second line here é");
  });

  it("detects the cover via EPUB 3 properties, EPUB 2 meta, name fallback, and first spine image", async () => {
    const props = await extractEpubMetadata(
      await buildEpub({ cover: { marking: "properties", format: "jpeg" } }),
    );
    expect(props.cover?.mediaType).toBe("image/jpeg");
    expect(props.cover?.href).toBe("OEBPS/images/cover.jpg");

    const metaOnly = await extractEpubMetadata(
      await buildEpub({ version: "2.0", cover: { marking: "meta" } }),
    );
    expect(metaOnly.cover?.mediaType).toBe("image/png");

    const byName = await extractEpubMetadata(await buildEpub({ cover: { marking: "none" } }));
    expect(byName.cover?.href).toBe("OEBPS/images/cover.png");
    expect(byName.cover!.bytes.length).toBeGreaterThan(50);
  });

  it("falls back to the first image of the first spine document", async () => {
    const zip = zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="my%20dir/pkg.opf"/></rootfiles></container>`,
      ),
      "my dir/pkg.opf": strToU8(
        `﻿<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Odd</dc:title></opf:metadata><opf:manifest><opf:item id="p1" href="text/page%201.xhtml" media-type="application/xhtml+xml"/><opf:item id="i1" href="img/a%20b.gif" media-type="image/gif"/></opf:manifest><opf:spine><opf:itemref idref="p1"/></opf:spine></opf:package>`,
      ),
      "my dir/text/page 1.xhtml": strToU8(
        `<html><body><img src="../img/a%20b.gif"/></body></html>`,
      ),
      "my dir/img/a b.gif": new Uint8Array([71, 73, 70, 56, 57, 97]),
    });
    const meta = await extractEpubMetadata(zip);
    expect(meta.title).toBe("Odd");
    expect(meta.cover?.href).toBe("my dir/img/a b.gif");
    expect(meta.cover?.mediaType).toBe("image/gif");
    expect(meta.authors).toEqual([]);
  });

  it("warns when there is no cover and falls back to the file name for the title", async () => {
    const file = await makeEpub({ title: null, cover: false, creators: [] });
    const meta = await extractEpubMetadata(file);
    expect(meta.title).toBe("book");
    expect(meta.cover).toBeUndefined();
    expect(meta.warnings.length).toBeGreaterThanOrEqual(3);
    const noPath = await extractEpubMetadata(await buildEpub({ title: null }));
    expect(noPath.title).toBe("");
  });

  it("throws EpubError for non-EPUB input", async () => {
    await expect(extractEpubMetadata(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(
      EpubError,
    );
    const truncated = (await buildEpub()).slice(0, 200);
    await expect(extractEpubMetadata(truncated)).rejects.toMatchObject({ name: "EpubError" });
    const noContainer = zipSync({ "a.txt": strToU8("hi") });
    await expect(extractEpubMetadata(noContainer)).rejects.toMatchObject({
      code: "missing-container",
    });
    await expect(extractEpubMetadata("/nonexistent/file.epub")).rejects.toBeInstanceOf(EpubError);
  });
});
