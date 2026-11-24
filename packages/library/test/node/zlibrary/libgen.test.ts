import { describe, expect, it } from "vitest";
import { parseLibgenResults } from "../../../src/node/zlibrary/libgen.ts";

const MD5 = "0123456789abcdef0123456789abcdef";
const html = `<table id="tablelibgen"><tr><th>Title</th></tr>
<tr>
<td><a data-html="true" title="Add<br>Lettere" href="edition.php?id=1">Lettere a Lucilio <i></i></a> <nobr><span>b</span></nobr></td>
<td>Seneca, Lucio Anneo,  </td><td>Mondadori</td><td>2019</td><td>Italian</td><td>320</td>
<td><a href="file.php?id=9">1.5 MB</a></td><td>epub</td>
<td><a href="/ads.php?md5=${MD5}">GET</a></td></tr></table>`;

describe("LibGen parser", () => {
  it("maps a result row to a book", () => {
    const [b] = parseLibgenResults(html);
    expect(b).toMatchObject({
      id: "libgen",
      hash: MD5,
      author: "Seneca, Lucio Anneo",
      year: 2019,
      extension: "EPUB",
      pages: 320,
      language: "Italian",
    });
    expect(b!.title).toBe("Lettere a Lucilio");
    expect(b!.size).toBe(Math.round(1.5 * 1024 * 1024));
  });
  it("ignores rows without md5", () => {
    expect(parseLibgenResults("<table><tr><td>x</td></tr></table>")).toEqual([]);
  });
});
