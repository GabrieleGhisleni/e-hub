import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../../src/node/site-data/markdown.ts";

const html = (md: string) => renderMarkdown(md) ?? "";

describe("renderMarkdown URL safety", () => {
  const bad = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java%0Ascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ];
  for (const url of bad) {
    it(`neutralizes link ${url}`, () => {
      const out = html(`[click](<${url}>)`);
      expect(out).not.toMatch(/href=/i);
      expect(out).toContain("click");
    });
    it(`drops image ${url}`, () => {
      const out = html(`![alt text](<${url}>)`);
      expect(out).not.toMatch(/<img/i);
      expect(out).toContain("alt text");
    });
  }

  it("never lets entities decode into a scheme", () => {
    // Plain destinations: marked decodes the entities, our check then sees `javascript:`.
    for (const url of [
      "java&#115;cript:alert(1)",
      "java&#x73;cript:alert(1)",
      "javascript&colon;alert(1)",
    ]) {
      const out = html(`[c](${url}) ![i](${url})`);
      expect(out).not.toMatch(/(?:href|src)="javascript:/i);
      // Whatever remains is HTML-escaped, so the browser never sees a literal `javascript:` scheme.
      expect(out).not.toMatch(/(?:href|src)="java[^"]*script:/i);
    }
  });

  it("neutralizes tab/newline inside the scheme", () => {
    expect(html("[x](<java\tscript:alert(1)>)")).not.toMatch(/href=/);
    expect(html('<a href="javascript:alert(1)">x</a>')).not.toMatch(/<a /);
  });

  it("neutralizes reference-style links and images", () => {
    expect(html("[ref]\n\n[ref]: javascript:alert(1)")).not.toMatch(/href=/);
    expect(html("[x][r]\n\n[r]: data:text/html,hi")).not.toMatch(/href=/);
    expect(html("![alt][r]\n\n[r]: javascript:alert(1)")).not.toMatch(/<img/);
  });

  it("neutralizes autolinks", () => {
    expect(html("<javascript:alert(1)>")).not.toMatch(/(?:href|src)="javascript:/i);
  });

  it("keeps safe URLs", () => {
    expect(html("[a](https://example.com/x?a=1&b=2)")).toContain(
      'href="https://example.com/x?a=1&amp;b=2"',
    );
    expect(html("[a](HTTP://example.com)")).toContain("<a href=");
    expect(html("[a](mailto:me@example.com)")).toContain('href="mailto:me@example.com"');
    expect(html("[a](#sec)")).toContain('href="#sec"');
    expect(html("[a](../other.md)")).toContain('href="../other.md"');
    expect(html("[a](/abs/path)")).toContain('href="/abs/path"');
    expect(html("[a](page?x=1:2)")).toContain("<a href=");
    expect(html('![alt](cover.png "t")')).toContain('<img src="cover.png" alt="alt" title="t">');
    expect(html("![alt](https://example.com/i.png)")).toContain('src="https://example.com/i.png"');
  });

  it("still escapes raw HTML", () => {
    expect(html("<script>alert(1)</script>")).not.toContain("<script");
  });
});
