import { describe, expect, it } from "vitest";
import { demoteHeadings } from "../../src/web/lib/html.ts";

describe("demoteHeadings", () => {
  it("maps the highest heading to h3 and keeps relative depth, capped at h6", () => {
    const html = '<h1>A</h1>\n<h2 id="b">B</h2><h4>C</h4><h5>D</h5><h6>E</h6>';
    expect(demoteHeadings(html)).toBe(
      '<h3>A</h3>\n<h4 id="b">B</h4><h6>C</h6><h6>D</h6><h6>E</h6>',
    );
  });
  it("treats ## as the top level when there is no #", () => {
    expect(demoteHeadings("<h2>A</h2><h3>B</h3>")).toBe("<h3>A</h3><h4>B</h4>");
  });
  it("never promotes headings", () => {
    expect(demoteHeadings("<h4>A</h4><h5>B</h5>")).toBe("<h4>A</h4><h5>B</h5>");
  });
  it("leaves other tags and text alone", () => {
    const html = "<p>h1 &lt;h2&gt; <strong>x</strong></p><hr><header>y</header>";
    expect(demoteHeadings(html)).toBe(html);
  });
  it("accepts a custom top level", () => {
    expect(demoteHeadings("<h1>A</h1>", 2)).toBe("<h2>A</h2>");
  });
});
