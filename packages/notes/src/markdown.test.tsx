// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMarkdown, markdownPreview, preserveLineBreaks } from "./markdown";
import type { ReactElement } from "react";

afterEach(cleanup);
const renderToStaticMarkup = (el: ReactElement) => render(el).container.innerHTML;

describe("preserveLineBreaks", () => {
  it("keeps single line breaks of plain-text notes as hard breaks", () => {
    expect(preserveLineBreaks("riga uno\nriga due")).toBe("riga uno  \nriga due");
  });

  it("leaves lists, headings, blank lines and code fences alone", () => {
    const md = "Titolo\n- uno\n- due\n\n# H\ntesto\n```\na\nb\n```";
    expect(preserveLineBreaks(md)).toBe("Titolo\n- uno\n- due\n\n# H  \ntesto\n```\na\nb\n```");
  });
});

describe("markdownPreview", () => {
  it("strips the Markdown marks for one-line previews", () => {
    expect(markdownPreview("**Tesi** del libro\n- *uno* (cap. 2)\n- [link](https://x.it)")).toBe(
      "Tesi del libro uno (cap. 2) link",
    );
  });
});

describe("NoteMarkdown", () => {
  it("renders bold, lists and links, without raw HTML", () => {
    const html = renderToStaticMarkup(
      <NoteMarkdown text={"**Tesi**: il tempo\n\n- uno\n- due\n\n<b>x</b> https://example.org"} />,
    );
    expect(html).toContain("<strong>Tesi</strong>");
    expect(html).toContain("<li>uno</li>");
    expect(html).toContain('href="https://example.org"');
    expect(html).not.toContain("<b>x</b>");
  });

  it("marks search matches inside the text, not inside code", () => {
    const html = renderToStaticMarkup(<NoteMarkdown text={"Il **tempo** passa, `tempo` resta"} tokens={["tempo"]} />);
    expect(html).toMatch(/<strong><mark[^>]*>tempo<\/mark><\/strong>/);
    expect(html).toContain("<code>tempo</code>");
  });
});
