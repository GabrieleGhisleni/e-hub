import { describe, expect, it } from "vitest";
import {
  DRIVE_BASE_MAX_BYTES,
  DRIVE_BASE_MAX_CHARS,
  driveBaseName,
  driveFileName,
  parseDriveFileName,
  parseIdFromDriveName,
  sanitizeNameSegment,
  topicFolderName,
  truncateName,
} from "../../src/shared/naming.ts";
import { graphemes, utf8Length } from "../../src/shared/text.ts";

const id = "7k2m9q4t";
const book = (title: string, authors: string[] = ["Yuval Noah Harari"]) => ({ id, title, authors });

const FAT32_FORBIDDEN = /[:?"*<>|\\/\p{Cc}]/u;

describe("driveFileName", () => {
  it("formats <first author> - <title> [<id>] with both extensions", () => {
    expect(driveFileName(book("Sapiens: Da animali a dèi"), "epub")).toBe(
      "Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].epub",
    );
    expect(driveFileName(book("Sapiens: Da animali a dèi"), "kepub")).toBe(
      "Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].kepub.epub",
    );
  });

  it("uses only the first author", () => {
    const name = driveFileName(
      book("Freakonomics", ["Steven D. Levitt", "Stephen J. Dubner"]),
      "epub",
    );
    expect(name).toBe("Steven D. Levitt - Freakonomics [7k2m9q4t].epub");
  });

  it("normalizes to NFC", () => {
    const decomposed = "Cos'è la filosofia".normalize("NFD");
    const name = driveFileName(book(decomposed, ["Pierre Hadot"]), "epub");
    expect(name).toBe("Pierre Hadot - Cos'è la filosofia [7k2m9q4t].epub");
    expect(name.normalize("NFC")).toBe(name);
  });

  it("replaces every FAT32-forbidden character", () => {
    const name = driveFileName(
      book('A/B: "Quoted" <tag> | Why? * Back\\slash', ["Autore: Nome"]),
      "kepub",
    );
    expect(name).toBe("Autore - Nome - A-B - 'Quoted' tag - Why Back-slash [7k2m9q4t].kepub.epub");
    expect(name.replace(/\[7k2m9q4t\]\.kepub\.epub$/, "")).not.toMatch(FAT32_FORBIDDEN);
  });

  it("removes control and invisible characters and collapses whitespace", () => {
    const name = driveFileName(
      book("Riga\tuno\n\nriga due​\u0007  fine", ["  Ada   Lovelace "]),
      "epub",
    );
    expect(name).toBe("Ada Lovelace - Riga uno riga due fine [7k2m9q4t].epub");
  });

  it("truncates very long titles at a word boundary", () => {
    const title = `${"Parola ".repeat(40)}finale`;
    const base = driveBaseName(book(title));
    expect(graphemes(base).length).toBeLessThanOrEqual(DRIVE_BASE_MAX_CHARS);
    expect(base.endsWith("Parola")).toBe(true);
    expect(base.startsWith("Yuval Noah Harari - Parola Parola")).toBe(true);
    expect(driveFileName(book(title), "kepub")).toBe(`${base} [7k2m9q4t].kepub.epub`);
  });

  it("hard-cuts a single endless word and never leaves trailing separators", () => {
    const base = driveBaseName(book("x".repeat(300)));
    expect(graphemes(base).length).toBe(DRIVE_BASE_MAX_CHARS);
    const cutAtSeparator = driveBaseName(book(`${"a".repeat(98)}: ${"b".repeat(80)}`, ["Autore"]));
    expect(cutAtSeparator).not.toMatch(/[\s-]$/);
  });

  it("caps very long author names so the title still shows", () => {
    const author =
      "Associazione Internazionale per lo Studio della Storia del Pensiero Filosofico Medievale";
    const base = driveBaseName(book("Annali", [author]));
    expect(base.endsWith(" - Annali")).toBe(true);
    expect(base.length).toBeLessThan(author.length + 9);
  });

  it("respects the UTF-8 byte limit for non-Latin titles", () => {
    const base = driveBaseName(book("漢字".repeat(100), ["村上春樹"]));
    expect(utf8Length(base)).toBeLessThanOrEqual(DRIVE_BASE_MAX_BYTES);
    expect(
      utf8Length(driveFileName(book("漢字".repeat(100), ["村上春樹"]), "kepub")),
    ).toBeLessThanOrEqual(255);
  });

  it("never splits a surrogate pair or a grapheme", () => {
    const base = driveBaseName(book("📚".repeat(200), ["A"]));
    expect(base).toMatch(/^A - (📚)+$/u);
  });

  it("never starts with a dot and falls back when everything is stripped", () => {
    expect(driveBaseName(book("...E poi", ["...Anonimo"]))).toBe("Anonimo - ...E poi");
    expect(driveBaseName(book("???", ["***"]))).toBe("Senza titolo");
    expect(driveBaseName(book("Solo titolo", ["???"]))).toBe("Solo titolo");
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

describe("parseDriveFileName / parseIdFromDriveName", () => {
  it("reads id and kind back from produced names", () => {
    const b = book("Sapiens: Da animali a dèi");
    expect(parseDriveFileName(driveFileName(b, "epub"))).toEqual({ id, kind: "epub" });
    expect(parseDriveFileName(driveFileName(b, "kepub"))).toEqual({ id, kind: "kepub" });
    expect(parseIdFromDriveName(`Archivio/Saggistica/${driveFileName(b, "epub")}`)).toBe(id);
  });
  it("only trusts the bracket group right before the extension", () => {
    expect(parseIdFromDriveName("Titolo [aaaaaaaa] altro [7k2m9q4t].epub")).toBe(id);
    expect(parseIdFromDriveName("Titolo [7k2m9q4t] copia.epub")).toBeNull();
  });
  it("is lenient on case, strict on the alphabet", () => {
    expect(parseDriveFileName("X [7K2M9Q4T].KEPUB.EPUB")).toEqual({ id, kind: "kepub" });
    expect(parseIdFromDriveName("X [7k2m9q4i].epub")).toBeNull();
    expect(parseIdFromDriveName("X [7k2m9q4t].pdf")).toBeNull();
    expect(parseIdFromDriveName("vecchio libro.epub")).toBeNull();
  });
});
