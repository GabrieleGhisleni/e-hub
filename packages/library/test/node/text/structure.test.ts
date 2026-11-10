import { describe, expect, it } from "vitest";
import { buildChapters } from "../../../src/node/text/chapters.ts";
import { EpubTextError, readEpubStructure } from "../../../src/node/text/structure.ts";
import { buildEpub } from "../../helpers/index.ts";
import { buildCustomEpub } from "./custom-epub.ts";

const words = (n: number, w = "parola") => Array.from({ length: n }, () => w).join(" ");

describe("chapters from synthetic books", () => {
  it("splits an EPUB 3 book per chapter with titles from the nav", async () => {
    const chapters = buildChapters(readEpubStructure(await buildEpub()));
    expect(chapters.map((c) => c.title)).toEqual([
      "Capitolo primo",
      "Capitolo secondo",
      "Capitolo terzo",
    ]);
    expect(chapters[0]!.markdown).toContain("# Capitolo primo");
    expect(chapters[0]!.markdown).toContain("## Una sezione");
    expect(chapters[0]!.markdown).toContain("Testo sintetico del primo capitolo.");
    expect(chapters[0]!.markdown).not.toContain("<");
    expect(chapters.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(chapters[1]!.words).toBeGreaterThan(3);
  });

  it("reads titles from the NCX when the book has no nav (EPUB 2)", async () => {
    const bytes = await buildEpub({
      version: "2.0",
      chapters: [
        { title: "Uno", paragraphs: ["a b c"] },
        { title: "Due", paragraphs: ["d e f"] },
      ],
    });
    const structure = readEpubStructure(bytes);
    expect(structure.toc.map((t) => t.title)).toEqual(["Uno", "Due"]);
    expect(buildChapters(structure).map((c) => c.title)).toEqual(["Uno", "Due"]);
  });

  it("falls back to first heading, then 'Capitolo N', when there is no TOC", () => {
    const bytes = buildCustomEpub({
      docs: {
        "a.xhtml": `<h1>Il primo titolo</h1><p>${words(5)}</p>`,
        "b.xhtml": `<p>${words(5)}</p>`,
      },
    });
    const chapters = buildChapters(readEpubStructure(bytes));
    expect(chapters.map((c) => c.title)).toEqual(["Il primo titolo", "Capitolo 2"]);
    expect(chapters[1]!.markdown.startsWith("# Capitolo 2")).toBe(true);
  });

  it("appends spine files without a TOC entry to the previous chapter", () => {
    const bytes = buildCustomEpub({
      docs: {
        "c1a.xhtml": `<h1>Uno</h1><p>prima parte</p>`,
        "c1b.xhtml": `<p>seconda parte dello stesso capitolo</p>`,
        "c2.xhtml": `<h1>Due</h1><p>altro</p>`,
      },
      nav: `<li><a href="c1a.xhtml">Uno</a></li><li><a href="c2.xhtml">Due</a></li>`,
    });
    const chapters = buildChapters(readEpubStructure(bytes));
    expect(chapters.map((c) => c.title)).toEqual(["Uno", "Due"]);
    expect(chapters[0]!.markdown).toContain("prima parte");
    expect(chapters[0]!.markdown).toContain("seconda parte dello stesso capitolo");
  });

  it("splits one file at TOC fragment anchors", () => {
    const bytes = buildCustomEpub({
      docs: {
        "all.xhtml": `<h1 id="s1">Primo</h1><p>testo uno</p><h1 id="s2">Secondo</h1><p>testo due</p><div><a id="s3"/></div><p>testo tre</p>`,
      },
      ncx: `<navPoint id="1"><navLabel><text>Primo</text></navLabel><content src="all.xhtml#s1"/></navPoint>
<navPoint id="2"><navLabel><text>Secondo</text></navLabel><content src="all.xhtml#s2"/></navPoint>
<navPoint id="3"><navLabel><text>Terzo</text></navLabel><content src="all.xhtml#s3"/></navPoint>`,
    });
    const chapters = buildChapters(readEpubStructure(bytes));
    expect(chapters.map((c) => c.title)).toEqual(["Primo", "Secondo", "Terzo"]);
    expect(chapters[0]!.markdown).toContain("testo uno");
    expect(chapters[0]!.markdown).not.toContain("testo due");
    expect(chapters[1]!.markdown).toContain("testo due");
    expect(chapters[2]!.markdown).toContain("testo tre");
    expect(chapters[2]!.markdown).not.toContain("ELIBSPLIT");
  });

  it("treats a missing fragment as the start of the file and keeps parts under a chapter", () => {
    const bytes = buildCustomEpub({
      docs: { "a.xhtml": `<p>${words(30)}</p>`, "b.xhtml": `<h1>B</h1><p>testo b</p>` },
      nav: `<li><a href="a.xhtml#nope">Il primo</a></li><li><a href="b.xhtml">Il secondo</a></li>`,
    });
    const chapters = buildChapters(readEpubStructure(bytes));
    expect(chapters.map((c) => c.title)).toEqual(["Il primo", "Il secondo"]);
  });

  it("uses the child as chapter when parent and first child start at the same place", () => {
    const bytes = buildCustomEpub({
      docs: { "a.xhtml": `<h1 id="x">A</h1><p>uno</p><h2 id="y">A2</h2><p>due</p>` },
      nav: `<li><a href="a.xhtml">Parte</a><ol><li><a href="a.xhtml">A</a></li><li><a href="a.xhtml#y">A2</a></li></ol></li>`,
    });
    const chapters = buildChapters(readEpubStructure(bytes));
    expect(chapters.map((c) => c.title)).toEqual(["A", "A2"]);
  });

  it("keeps front matter only when it has enough text", () => {
    const make = (n: number) =>
      buildCustomEpub({
        docs: { "f.xhtml": `<p>${words(n)}</p>`, "c.xhtml": `<h1>Uno</h1><p>testo</p>` },
        nav: `<li><a href="c.xhtml">Uno</a></li>`,
      });
    expect(buildChapters(readEpubStructure(make(3))).map((c) => c.title)).toEqual(["Uno"]);
    expect(buildChapters(readEpubStructure(make(40))).map((c) => c.title)).toEqual([
      "Materiale iniziale",
      "Uno",
    ]);
  });

  it("converts markup: emphasis, lists, quotes, footnotes, images by alt, no script or style", () => {
    const bytes = buildCustomEpub({
      docs: {
        "a.xhtml": `<h1>Uno</h1><p>Un <em>forte</em> e <strong>grosso</strong>.<a epub:type="noteref" href="#n1"><sup>1</sup></a></p>
<ul><li>alfa</li><li>beta</li></ul><blockquote><p>citazione</p></blockquote>
<img src="x.png" alt="schema del mondo"/><img src="y.png"/><script>alert(1)</script><style>p{}</style>
<aside epub:type="footnote" id="n1"><p>1 testo della nota</p></aside>
<p><a href="b.xhtml#q">un rimando</a></p>`,
      },
      nav: `<li><a href="a.xhtml">Uno</a></li>`,
    });
    const md = buildChapters(readEpubStructure(bytes))[0]!.markdown;
    expect(md).toContain("*forte*");
    expect(md).toContain("**grosso**");
    expect(md).toContain("[1]");
    expect(md).toMatch(/^- alfa$/m);
    expect(md).toContain("> citazione");
    expect(md).toContain("schema del mondo");
    expect(md).toContain("testo della nota");
    expect(md).toContain("un rimando");
    expect(md).not.toContain("alert");
    expect(md).not.toContain("color");
    expect(md).not.toContain("b.xhtml");
    expect(md).not.toContain("x.png");
  });

  it("rejects things that are not EPUBs", () => {
    expect(() => readEpubStructure(new Uint8Array([1, 2, 3]))).toThrow(EpubTextError);
  });
});
