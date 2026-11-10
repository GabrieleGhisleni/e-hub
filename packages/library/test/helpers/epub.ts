/**
 * Synthetic EPUB builder for tests (W2a metadata/cover extraction, W4b text extraction, upload flows).
 * Everything is generated: no real book text ever enters the repo.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Zippable, strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { makeTrackedTempDir } from "./tmp.ts";

export interface EpubCreator {
  name: string;
  /** EPUB3: `<meta refines property="file-as">`; EPUB2: `opf:file-as`. */
  fileAs?: string;
  /** MARC relator, default "aut". */
  role?: string;
}

export interface EpubChapter {
  title: string;
  /** Extra `<h2>` headings, each followed by one paragraph. */
  sections?: string[];
  paragraphs?: string[];
}

export interface EpubCoverOptions {
  format?: "png" | "jpeg";
  width?: number;
  height?: number;
  background?: string;
  /**
   * How the cover is declared: EPUB3 `properties="cover-image"`, EPUB2 `<meta name="cover">`, both
   * (default for EPUB3), or none (image in the manifest but not marked as cover).
   */
  marking?: "properties" | "meta" | "both" | "none";
}

export interface MakeEpubOptions {
  /** "3.0" (default): nav.xhtml + toc.ncx, `refines` metadata. "2.0": EPUB2-style OPF (opf: attributes, NCX only). */
  version?: "3.0" | "2.0";
  /** `null` omits `<dc:title>`. */
  title?: string | null;
  /** `[]` omits every `<dc:creator>`. Strings are shorthand for `{ name }`. */
  creators?: (string | EpubCreator)[];
  subjects?: string[];
  /** `null` omits the ISBN identifier. */
  isbn?: string | null;
  /** "urn" → `urn:isbn:978…` (default), "plain" → `978…` (EPUB2 adds opf:scheme="ISBN"). */
  isbnStyle?: "urn" | "plain";
  language?: string | null;
  publisher?: string | null;
  description?: string | null;
  /** `false` (or `null`) → no cover image at all. Default: a 300×450 PNG made with sharp. */
  cover?: EpubCoverOptions | boolean | null;
  /** Default: three chapters with headings. */
  chapters?: EpubChapter[];
  /** Override nav/ncx presence (EPUB3 defaults: both true; EPUB2: ncx only). */
  nav?: boolean;
  ncx?: boolean;
  /** OPF location inside the zip (container.xml points to it). Default "OEBPS/content.opf". */
  opfPath?: string;
  /** Raw XML appended inside `<metadata>`, for edge cases. */
  extraMetadataXml?: string;
  /** Where to write the file. Default: `book.epub` in a fresh temp dir. */
  outPath?: string;
}

export const DEFAULT_EPUB_METADATA: {
  readonly title: string;
  readonly creators: readonly EpubCreator[];
  readonly subjects: readonly string[];
  readonly isbn: string;
  readonly language: string;
  readonly publisher: string;
  readonly description: string;
} = {
  title: "Il giardino delle prove",
  creators: [{ name: "Ada Esempio", fileAs: "Esempio, Ada" }, { name: "Bruno Campione" }],
  subjects: ["Narrativa", "Test"],
  isbn: "9788800000000",
  language: "it",
  publisher: "Editore di Prova",
  description: "Un libro sintetico generato per i test.",
};

const DEFAULT_CHAPTERS: EpubChapter[] = [
  {
    title: "Capitolo primo",
    sections: ["Una sezione"],
    paragraphs: ["Testo sintetico del primo capitolo.", "Un secondo paragrafo."],
  },
  { title: "Capitolo secondo", paragraphs: ["Testo sintetico del secondo capitolo."] },
  {
    title: "Capitolo terzo",
    sections: ["Prima parte", "Seconda parte"],
    paragraphs: ["Testo sintetico del terzo capitolo."],
  },
];

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function chapterXhtml(chapter: EpubChapter, lang: string): string {
  const sections = (chapter.sections ?? [])
    .map(
      (s) =>
        `      <h2>${escapeXml(s)}</h2>\n      <p>Paragrafo della sezione ${escapeXml(s)}.</p>`,
    )
    .join("\n");
  const paragraphs = (chapter.paragraphs ?? [])
    .map((p) => `      <p>${escapeXml(p)}</p>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
  </head>
  <body>
    <section epub:type="chapter">
      <h1>${escapeXml(chapter.title)}</h1>
${paragraphs}
${sections}
    </section>
  </body>
</html>
`;
}

function navXhtml(chapters: EpubChapter[], lang: string): string {
  const items = chapters
    .map(
      (c, i) => `        <li><a href="text/chapter-${i + 1}.xhtml">${escapeXml(c.title)}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
  <head>
    <title>Indice</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Indice</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function tocNcx(chapters: EpubChapter[], uid: string, title: string): string {
  const points = chapters
    .map(
      (c, i) => `    <navPoint id="np-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="text/chapter-${i + 1}.xhtml"/>
    </navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/** Builds the EPUB in memory. `mimetype` is the first entry, stored uncompressed (OCF requirement). */
export async function buildEpub(options: MakeEpubOptions = {}): Promise<Uint8Array> {
  const version = options.version ?? "3.0";
  const epub3 = version === "3.0";
  const title = options.title === undefined ? DEFAULT_EPUB_METADATA.title : options.title;
  const creators: EpubCreator[] = (options.creators ?? DEFAULT_EPUB_METADATA.creators).map((c) =>
    typeof c === "string" ? { name: c } : c,
  );
  const subjects = options.subjects ?? [...DEFAULT_EPUB_METADATA.subjects];
  const isbn = options.isbn === undefined ? DEFAULT_EPUB_METADATA.isbn : options.isbn;
  const language =
    options.language === undefined ? DEFAULT_EPUB_METADATA.language : options.language;
  const publisher =
    options.publisher === undefined ? DEFAULT_EPUB_METADATA.publisher : options.publisher;
  const description =
    options.description === undefined ? DEFAULT_EPUB_METADATA.description : options.description;
  const chapters = options.chapters ?? DEFAULT_CHAPTERS;
  const withNav = options.nav ?? epub3;
  const withNcx = options.ncx ?? true;
  const opfPath = options.opfPath ?? "OEBPS/content.opf";
  const lang = language ?? "und";
  const uid = "urn:uuid:00000000-0000-4000-8000-000000000000";

  const coverOption = options.cover === undefined || options.cover === true ? {} : options.cover;
  const cover = coverOption === false || coverOption === null ? null : coverOption;
  const coverFormat = cover?.format ?? "png";
  const coverMarking = cover?.marking ?? (epub3 ? "both" : "meta");
  const coverHref = `images/cover.${coverFormat === "png" ? "png" : "jpg"}`;
  const coverMediaType = coverFormat === "png" ? "image/png" : "image/jpeg";

  // ---- metadata
  const meta: string[] = [`<dc:identifier id="pub-id">${uid}</dc:identifier>`];
  if (isbn !== null) {
    const value = (options.isbnStyle ?? "urn") === "urn" ? `urn:isbn:${isbn}` : isbn;
    meta.push(
      epub3
        ? `<dc:identifier id="isbn-id">${escapeXml(value)}</dc:identifier>`
        : `<dc:identifier opf:scheme="ISBN">${escapeXml(value)}</dc:identifier>`,
    );
  }
  if (title !== null) meta.push(`<dc:title>${escapeXml(title)}</dc:title>`);
  creators.forEach((c, i) => {
    const role = c.role ?? "aut";
    if (epub3) {
      meta.push(`<dc:creator id="creator-${i + 1}">${escapeXml(c.name)}</dc:creator>`);
      if (c.fileAs) {
        meta.push(
          `<meta refines="#creator-${i + 1}" property="file-as">${escapeXml(c.fileAs)}</meta>`,
        );
      }
      meta.push(
        `<meta refines="#creator-${i + 1}" property="role" scheme="marc:relators">${escapeXml(role)}</meta>`,
      );
    } else {
      const fileAs = c.fileAs ? ` opf:file-as="${escapeXml(c.fileAs)}"` : "";
      meta.push(
        `<dc:creator opf:role="${escapeXml(role)}"${fileAs}>${escapeXml(c.name)}</dc:creator>`,
      );
    }
  });
  if (language !== null) meta.push(`<dc:language>${escapeXml(language)}</dc:language>`);
  if (publisher !== null) meta.push(`<dc:publisher>${escapeXml(publisher)}</dc:publisher>`);
  if (description !== null) meta.push(`<dc:description>${escapeXml(description)}</dc:description>`);
  for (const s of subjects) meta.push(`<dc:subject>${escapeXml(s)}</dc:subject>`);
  if (epub3) meta.push(`<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>`);
  if (cover && (coverMarking === "meta" || coverMarking === "both")) {
    meta.push(`<meta name="cover" content="cover-image"/>`);
  }
  if (options.extraMetadataXml) meta.push(options.extraMetadataXml);

  // ---- manifest + spine
  const manifest: string[] = [];
  if (withNav) {
    manifest.push(
      `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    );
  }
  if (withNcx)
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  if (cover) {
    const props =
      epub3 && (coverMarking === "properties" || coverMarking === "both")
        ? ` properties="cover-image"`
        : "";
    manifest.push(
      `<item id="cover-image" href="${coverHref}" media-type="${coverMediaType}"${props}/>`,
    );
  }
  chapters.forEach((_, i) => {
    manifest.push(
      `<item id="chapter-${i + 1}" href="text/chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    );
  });
  const spine = chapters.map((_, i) => `<itemref idref="chapter-${i + 1}"/>`);

  const opfNs = epub3 ? "" : ` xmlns:opf="http://www.idpf.org/2007/opf"`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="pub-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"${opfNs}>
    ${meta.join("\n    ")}
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine${withNcx ? ` toc="ncx"` : ""}>
    ${spine.join("\n    ")}
  </spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  const opfDir = path.posix.dirname(opfPath);
  const inOpfDir = (p: string) => (opfDir === "." ? p : `${opfDir}/${p}`);

  // Insertion order = zip order: mimetype first, stored (level 0).
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    [opfPath]: strToU8(opf),
  };
  if (withNav) files[inOpfDir("nav.xhtml")] = strToU8(navXhtml(chapters, lang));
  if (withNcx) files[inOpfDir("toc.ncx")] = strToU8(tocNcx(chapters, uid, title ?? "Senza titolo"));
  chapters.forEach((c, i) => {
    files[inOpfDir(`text/chapter-${i + 1}.xhtml`)] = strToU8(chapterXhtml(c, lang));
  });
  if (cover) {
    const image = sharp({
      create: {
        width: cover.width ?? 300,
        height: cover.height ?? 450,
        channels: 3,
        background: cover.background ?? "#8a5a44",
      },
    });
    const bytes = await (coverFormat === "png" ? image.png() : image.jpeg()).toBuffer();
    files[inOpfDir(coverHref)] = [new Uint8Array(bytes), { level: 0 }];
  }

  return zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
}

/** Writes a synthetic EPUB (see `MakeEpubOptions`) and returns its absolute path. */
export async function makeEpub(options: MakeEpubOptions = {}): Promise<string> {
  const outPath = options.outPath ?? path.join(await makeTrackedTempDir("elib-epub-"), "book.epub");
  await writeFile(outPath, await buildEpub(options));
  return outPath;
}
