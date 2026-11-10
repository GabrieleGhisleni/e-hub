/** Hand-made EPUBs for structure edge cases the shared builder cannot express (fragments, multi-file chapters). */
import { strToU8, zipSync } from "fflate";

export interface CustomEpub {
  /** Spine documents, in reading order: path under OEBPS/ → body HTML. */
  docs: Record<string, string>;
  /** `<li>` markup of the nav `<ol>` (hrefs relative to OEBPS/). */
  nav?: string;
  /** `<navPoint>` markup of the NCX. */
  ncx?: string;
  extraFiles?: Record<string, string>;
}

const xhtml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title><style>p{color:red}</style></head><body>${body}</body></html>`;

export function buildCustomEpub(options: CustomEpub): Uint8Array {
  const names = Object.keys(options.docs);
  const manifest = names
    .map((n, i) => `<item id="d${i}" href="${n}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = names.map((_, i) => `<itemref idref="d${i}"/>`).join("");
  const navItem = options.nav
    ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
    : "";
  const ncxItem = options.ncx
    ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
    : "";
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">x</dc:identifier><dc:title>Titolo EPUB</dc:title><dc:creator>Autore EPUB</dc:creator></metadata><manifest>${manifest}${navItem}${ncxItem}</manifest><spine${options.ncx ? ' toc="ncx"' : ""}>${spine}</spine></package>`;
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(opf),
  };
  for (const [name, body] of Object.entries(options.docs)) {
    files[`OEBPS/${name}`] = strToU8(xhtml(body));
  }
  if (options.nav) {
    files["OEBPS/nav.xhtml"] = strToU8(xhtml(`<nav epub:type="toc"><ol>${options.nav}</ol></nav>`));
  }
  if (options.ncx) {
    files["OEBPS/toc.ncx"] = strToU8(
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${options.ncx}</navMap></ncx>`,
    );
  }
  for (const [name, body] of Object.entries(options.extraFiles ?? {})) files[name] = strToU8(body);
  return zipSync(files);
}
