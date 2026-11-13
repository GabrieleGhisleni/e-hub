import { describe, expect, it } from "vitest";
import { sidecarContent, sidecarMetadataPath } from "../../../src/node/kobo/index.ts";
import type { Book } from "../../../src/shared/schema.ts";

const book: Book = {
  id: "7k2m9q4t",
  title: "Il giardino delle prove",
  authors: ["Ada Esempio", "Bruno Prova"],
  topic: "narrativa",
  status: "to-read",
  language: "it",
  description: "Una descrizione",
};

describe("sidecarContent", () => {
  it("writes the KOReader metadata exactly", () => {
    expect(sidecarContent(book, "Narrativa")).toBe(
      [
        "return {",
        '    ["custom_props"] = {',
        '        ["series"] = "Narrativa",',
        "    },",
        '    ["doc_props"] = {',
        '        ["authors"] = "Ada Esempio, Bruno Prova",',
        '        ["description"] = "Una descrizione",',
        '        ["language"] = "it",',
        '        ["title"] = "Il giardino delle prove",',
        "    },",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("omits the description and the language when the book has none", () => {
    const bare = sidecarContent(
      { ...book, description: undefined, language: undefined },
      "Filosofia",
    );
    expect(bare).not.toContain("description");
    expect(bare).not.toContain("language");
    expect(bare).toContain('["series"] = "Filosofia"');
    expect(bare.endsWith("}\n")).toBe(true);
  });

  it("escapes backslash, quote, newline and CR, and drops other control characters", () => {
    const tricky: Book = {
      ...book,
      title: 'Dice "sì" \\ fine\nriga\rdue\u0007!',
    };
    expect(sidecarContent(tricky, "Saggistica")).toContain(
      '["title"] = "Dice \\"sì\\" \\\\ fine\\nriga\\rdue!",',
    );
  });

  it("builds the metadata path inside the sidecar folder", () => {
    expect(sidecarMetadataPath(book)).toBe(
      "Ada Esempio - Il giardino delle prove [7k2m9q4t].kepub.sdr/custom_metadata.lua",
    );
  });
});
