import { describe, expect, it } from "vitest";
import {
  KOBO_BASE_MAX_BYTES,
  KOBO_BASE_MAX_CHARS,
  koboBaseName,
  koboFileName,
  parseIdFromKoboName,
  parseKoboFileName,
  sanitizeNameSegment,
  topicFolderName,
  truncateName,
} from "../../src/shared/naming.ts";
import { graphemes, utf8Length } from "../../src/shared/text.ts";

const id = "7k2m9q4t";
const book = (title: string, authors: string[] = ["Yuval Noah Harari"]) => ({ id, title, authors });

const FAT32_FORBIDDEN = /[:?"*<>|\\/\p{Cc}]/u;

describe("koboFileName", () => {
  it("formats <first author> - <title> [<id>].kepub.epub, and the .kepub.sdr sidecar folder", () => {
    expect(koboFileName(book("Sapiens: Da animali a dèi"), "kepub")).toBe(
      "Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].kepub.epub",
    );
    expect(koboFileName(book("Sapiens: Da animali a dèi"), "sidecar")).toBe(
      "Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].kepub.sdr",
    );
  });

  it("uses only the first author", () => {
    const name = koboFileName(
      book("Freakonomics", ["Steven D. Levitt", "Stephen J. Dubner"]),
      "kepub",
    );
    expect(name).toBe("Steven D. Levitt - Freakonomics [7k2m9q4t].kepub.epub");
  });

  it("normalizes to NFC", () => {
    const decomposed = "Cos'è la filosofia".normalize("NFD");
    const name = koboFileName(book(decomposed, ["Pierre Hadot"]), "kepub");
    expect(name).toBe("Pierre Hadot - Cos'è la filosofia [7k2m9q4t].kepub.epub");
    expect(name.normalize("NFC")).toBe(name);
  });

  it("replaces every FAT32-forbidden character", () => {
    const name = koboFileName(
      book('A/B: "Quoted" <tag> | Why? * Back\\slash', ["Autore: Nome"]),
      "kepub",
    );
    expect(name).toBe("Autore - Nome - A-B - 'Quoted' tag - Why Back-slash [7k2m9q4t].kepub.epub");
    expect(name.replace(/\[7k2m9q4t\]\.kepub\.epub$/, "")).not.toMatch(FAT32_FORBIDDEN);
  });

  it("removes control and invisible characters and collapses whitespace", () => {
    const name = koboFileName(
      book("Riga\tuno\n\nriga due​\u0007  fine", ["  Ada   Lovelace "]),
      "kepub",
    );
    expect(name).toBe("Ada Lovelace - Riga uno riga due fine [7k2m9q4t].kepub.epub");
  });

  it("truncates very long titles at a word boundary", () => {
    const title = `${"Parola ".repeat(40)}finale`;
    const base = koboBaseName(book(title));
    expect(graphemes(base).length).toBeLessThanOrEqual(KOBO_BASE_MAX_CHARS);
    expect(base.endsWith("Parola")).toBe(true);
    expect(base.startsWith("Yuval Noah Harari - Parola Parola")).toBe(true);
    expect(koboFileName(book(title), "kepub")).toBe(`${base} [7k2m9q4t].kepub.epub`);
  });

  it("hard-cuts a single endless word and never leaves trailing separators", () => {
    const base = koboBaseName(book("x".repeat(300)));
    expect(graphemes(base).length).toBe(KOBO_BASE_MAX_CHARS);
    const cutAtSeparator = koboBaseName(book(`${"a".repeat(98)}: ${"b".repeat(80)}`, ["Autore"]));
    expect(cutAtSeparator).not.toMatch(/[\s-]$/);
  });

  it("caps very long author names so the title still shows", () => {
    const author =
      "Associazione Internazionale per lo Studio della Storia del Pensiero Filosofico Medievale";
    const base = koboBaseName(book("Annali", [author]));
    expect(base.endsWith(" - Annali")).toBe(true);
    expect(base.length).toBeLessThan(author.length + 9);
  });

  it("respects the UTF-8 byte limit for non-Latin titles", () => {
    const base = koboBaseName(book("漢字".repeat(100), ["村上春樹"]));
    expect(utf8Length(base)).toBeLessThanOrEqual(KOBO_BASE_MAX_BYTES);
    expect(
      utf8Length(koboFileName(book("漢字".repeat(100), ["村上春樹"]), "kepub")),
    ).toBeLessThanOrEqual(255);
  });

  it("never splits a surrogate pair or a grapheme", () => {
    const base = koboBaseName(book("📚".repeat(200), ["A"]));
    expect(base).toMatch(/^A - (📚)+$/u);
  });

  it("never starts with a dot and falls back when everything is stripped", () => {
    expect(koboBaseName(book("...E poi", ["...Anonimo"]))).toBe("Anonimo - ...E poi");
    expect(koboBaseName(book("???", ["***"]))).toBe("Senza titolo");
    expect(koboBaseName(book("Solo titolo", ["???"]))).toBe("Solo titolo");
  });
});

describe("sanitizeNameSegment", () => {
  it.each([
    ["Sapiens: Da animali a dèi", "Sapiens - Da animali a dèi"],
    ["Sapiens : Da animali", "Sapiens - Da animali"],
    ["Re:Zero", "Re-Zero"],
    ["AC/DC", "AC-DC"],
    ["Titolo | Sottotitolo", "Titolo - Sottotitolo"],
    ["Che cos'è la filosofia?", "Che cos'è la filosofia"],
    ['Il "progresso"', "Il 'progresso'"],
    ["A : | B", "A - B"],
    ["Titolo:", "Titolo"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeNameSegment(input)).toBe(expected);
  });
});

describe("truncateName", () => {
  it("keeps short text unchanged", () => {
    expect(truncateName("breve", 10)).toBe("breve");
  });
  it("cuts exactly at a word end when the next char is a space", () => {
    expect(truncateName("uno due tre", 7)).toBe("uno due");
  });
});

describe("topicFolderName", () => {
  it("uses the label with the same sanitizer", () => {
    expect(topicFolderName("Da smistare")).toBe("Da smistare");
    expect(topicFolderName("Scienze: società/politica")).toBe("Scienze - società-politica");
  });
  it("is never empty, hidden or a DOS device name, and has no trailing dots", () => {
    expect(topicFolderName("???")).toBe("_");
    expect(topicFolderName(".nascosto")).toBe("nascosto");
    expect(topicFolderName("Varie...")).toBe("Varie");
    expect(topicFolderName("Con")).toBe("Con_");
    expect(topicFolderName("nul")).toBe("nul_");
  });
  it("is truncated", () => {
    expect(graphemes(topicFolderName("Argomento ".repeat(20))).length).toBeLessThanOrEqual(60);
  });
});

describe("parseKoboFileName / parseIdFromKoboName", () => {
  it("reads id and kind back from produced names", () => {
    const b = book("Sapiens: Da animali a dèi");
    expect(parseKoboFileName(koboFileName(b, "kepub"))).toEqual({ id, kind: "kepub" });
    expect(parseKoboFileName(koboFileName(b, "sidecar"))).toEqual({ id, kind: "sidecar" });
    expect(parseIdFromKoboName(`/mnt/onboard/books/${koboFileName(b, "kepub")}`)).toBe(id);
  });
  it("only trusts the bracket group right before the suffix", () => {
    expect(parseIdFromKoboName("Titolo [aaaaaaaa] altro [7k2m9q4t].kepub.epub")).toBe(id);
    expect(parseIdFromKoboName("Titolo [7k2m9q4t] copia.kepub.epub")).toBeNull();
  });
  it("is lenient on case, strict on the alphabet", () => {
    expect(parseKoboFileName("X [7K2M9Q4T].KEPUB.EPUB")).toEqual({ id, kind: "kepub" });
    expect(parseKoboFileName("X [7K2M9Q4T].KEPUB.SDR")).toEqual({ id, kind: "sidecar" });
    expect(parseIdFromKoboName("X [7k2m9q4i].kepub.epub")).toBeNull();
    expect(parseIdFromKoboName("X [7k2m9q4t].pdf")).toBeNull();
    expect(parseIdFromKoboName("vecchio libro.kepub.epub")).toBeNull();
  });
  it("never recognizes a plain EPUB or a hand-copied file as ours", () => {
    expect(parseKoboFileName("X [7k2m9q4t].epub")).toBeNull();
    expect(parseKoboFileName("Clear, James - Atomic habits.kepub.epub")).toBeNull();
  });
});
