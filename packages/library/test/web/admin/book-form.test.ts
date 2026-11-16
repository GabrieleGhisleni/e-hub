import { describe, expect, it } from "vitest";
import { BookPatchSchema, NewBookSchema } from "../../../src/shared/api.ts";
import {
  bookChangedSince,
  bookToFormState,
  diffToPatch,
  formStateFromMetadata,
  isEmptyPatch,
  normalizeIsbn,
  patchMovesFiles,
  toNewBook,
  validateForm,
} from "../../../src/web/admin/lib/book-form.ts";

const book = {
  title: "Pensieri lenti e veloci",
  authors: ["Daniel Kahneman"],
  topic: "psicologia",
  status: "read" as const,
  tags: ["bias", "decisioni"],
  startedAt: "2025-01-02",
  isbn: "9788804000000",
  description: "Un classico.",
};

describe("diffToPatch", () => {
  it("is empty when nothing changed", () => {
    const s = bookToFormState(book);
    expect(isEmptyPatch(diffToPatch(s, structuredClone(s)))).toBe(true);
  });

  it("contains only the changed fields", () => {
    const s = bookToFormState(book);
    const patch = diffToPatch(s, { ...s, status: "reading", publisher: " Adelphi " });
    expect(patch).toEqual({ status: "reading", publisher: "Adelphi" });
    expect(BookPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("sends null for an optional field the user emptied", () => {
    const s = bookToFormState(book);
    const patch = diffToPatch(s, { ...s, startedAt: "", description: "  ", tags: [], isbn: "" });
    expect(patch).toEqual({ startedAt: null, description: null, tags: null, isbn: null });
    expect(BookPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("never sends null for an optional field that was already empty", () => {
    const s = bookToFormState({ ...book, tags: undefined, publisher: undefined });
    expect(isEmptyPatch(diffToPatch(s, { ...s, publisher: "  " }))).toBe(true);
  });

  it("ignores whitespace-only differences and cleans authors", () => {
    const s = bookToFormState(book);
    expect(
      isEmptyPatch(
        diffToPatch(s, { ...s, title: `  ${book.title} `, authors: ["Daniel  Kahneman"] }),
      ),
    ).toBe(true);
    const patch = diffToPatch(s, { ...s, authors: ["Daniel Kahneman", " Amos Tversky ", ""] });
    expect(patch.authors).toEqual(["Daniel Kahneman", "Amos Tversky"]);
  });

  it("flags changes that rename the file on the Kobo (title or first author)", () => {
    const s = bookToFormState(book);
    expect(patchMovesFiles(diffToPatch(s, { ...s, title: "Altro" }), s.authors)).toBe(true);
    expect(
      patchMovesFiles(diffToPatch(s, { ...s, authors: ["Altro Autore", ...s.authors] }), s.authors),
    ).toBe(true);
    // Topic only rewrites the series in the metadata: no rename.
    expect(patchMovesFiles(diffToPatch(s, { ...s, topic: "filosofia" }), s.authors)).toBe(false);
    expect(
      patchMovesFiles(diffToPatch(s, { ...s, status: "to-read", tags: ["x"] }), s.authors),
    ).toBe(false);
  });

  it("normalizes the ISBN before comparing", () => {
    const s = bookToFormState(book);
    expect(isEmptyPatch(diffToPatch(s, { ...s, isbn: "978-88-04-00000-0" }))).toBe(true);
    expect(normalizeIsbn("978 88-04")).toBe("9788804");
  });
});

describe("toNewBook / formStateFromMetadata", () => {
  it("prefills from the extracted metadata", () => {
    const s = formStateFromMetadata(
      {
        title: "  Titolo ",
        authors: ["A. Autore"],
        subjects: ["Storia"],
        language: "it",
        isbn: "9788800000000",
      },
      { title: "fallback", topic: "unsorted" },
    );
    expect(s).toMatchObject({
      title: "Titolo",
      authors: ["A. Autore"],
      topic: "unsorted",
      status: "to-read",
      language: "it",
    });
    const none = formStateFromMetadata(
      { authors: [], subjects: [] },
      { title: "file", topic: "unsorted" },
    );
    expect(none.title).toBe("file");
  });

  it("omits empty optional fields and validates against the schema", () => {
    const s = formStateFromMetadata(
      { title: "T", authors: ["A"], subjects: [] },
      { title: "f", topic: "unsorted" },
    );
    const nb = toNewBook({ ...s, tags: ["x", " "], publisher: "" }, ["Storia", " "]);
    expect(nb).toEqual({
      title: "T",
      authors: ["A"],
      topic: "unsorted",
      status: "to-read",
      tags: ["x"],
      subjects: ["Storia"],
    });
    expect(NewBookSchema.safeParse(nb).success).toBe(true);
  });
});

describe("validateForm", () => {
  const ok = bookToFormState(book);
  it("accepts a valid form", () => expect(validateForm(ok)).toEqual({}));
  it("requires title, an author and a topic", () => {
    const e = validateForm({ ...ok, title: " ", authors: [" "], topic: "" });
    expect(Object.keys(e).sort()).toEqual(["authors", "title", "topic"]);
  });
  it("checks dates", () => {
    expect(validateForm({ ...ok, startedAt: "2025-02-30" }).startedAt).toBeDefined();
    expect(
      validateForm({ ...ok, startedAt: "2025-03-02", finishedAt: "2025-03-01" }).finishedAt,
    ).toBeDefined();
    expect(validateForm({ ...ok, startedAt: "2025-03-02", finishedAt: "2025-03-02" })).toEqual({});
  });
});

import type { CoverCandidate } from "../../../src/shared/api.ts";
import { defaultCoverChoice, openLibraryIdFor } from "../../../src/web/admin/lib/covers.ts";

describe("cover choice", () => {
  const epub: CoverCandidate = { source: "epub", url: "/e", needsConfirmation: false };
  const olIsbn: CoverCandidate = {
    source: "openlibrary",
    url: "/o",
    openLibraryCoverId: 7,
    matchedBy: "isbn",
    needsConfirmation: false,
  };
  const olTitle: CoverCandidate = { ...olIsbn, matchedBy: "title-author", needsConfirmation: true };

  it("prefers the EPUB cover", () => expect(defaultCoverChoice([epub, olIsbn])).toBe("epub"));
  it("never preselects a title/author match", () => {
    expect(defaultCoverChoice([olTitle])).toBe("placeholder");
    expect(defaultCoverChoice([epub, olTitle])).toBe("epub");
  });
  it("uses an ISBN match when it is the only candidate", () =>
    expect(defaultCoverChoice([olIsbn])).toBe("openlibrary"));
  it("falls back to the placeholder", () => expect(defaultCoverChoice([])).toBe("placeholder"));
  it("sends the Open Library id only for that choice", () => {
    expect(openLibraryIdFor("openlibrary", [olTitle])).toBe(7);
    expect(openLibraryIdFor("epub", [olTitle])).toBeUndefined();
  });
});

describe("frozen baseline (R1-09)", () => {
  const opened = {
    title: "T",
    authors: ["A"],
    topic: "unsorted",
    status: "to-read" as const,
  };
  const refreshed = { ...opened, topic: "filosofia", status: "reading" as const };

  it("detects an external change", () => {
    const baseline = bookToFormState(opened);
    expect(bookChangedSince(baseline, opened)).toBe(false);
    expect(bookChangedSince(baseline, refreshed)).toBe(true);
  });

  it("a patch from the frozen baseline contains only the user's edits", () => {
    const baseline = bookToFormState(opened);
    const edited = { ...baseline, title: "T2" };
    expect(diffToPatch(baseline, edited)).toEqual({ title: "T2" });
    // The old, buggy behaviour recomputed the baseline from the refreshed book:
    expect(diffToPatch(bookToFormState(refreshed), edited)).toMatchObject({ topic: "unsorted" });
  });
});

describe("year and translators", () => {
  it("round-trips through the form, the patch and a new book", () => {
    const initial = bookToFormState({ ...book, year: 2011, translators: ["Laura Serra"] });
    expect(initial.year).toBe("2011");
    expect(initial.translators).toEqual(["Laura Serra"]);

    const edited = { ...initial, year: "2012", translators: [] };
    expect(BookPatchSchema.parse(diffToPatch(initial, edited))).toEqual({ year: 2012, translators: null });
    expect(diffToPatch(initial, { ...initial, year: "" })).toEqual({ year: null });

    const created = toNewBook({ ...initial, year: "1999" });
    expect(NewBookSchema.parse(created)).toMatchObject({ year: 1999, translators: ["Laura Serra"] });
  });

  it("starts from the extracted metadata and rejects a bad year", () => {
    const state = formStateFromMetadata(
      { authors: ["A"], subjects: [], year: 2017, translators: ["B"] },
      { title: "T", topic: "unsorted" },
    );
    expect(state).toMatchObject({ year: "2017", translators: ["B"] });
    expect(validateForm({ ...state, year: "abcd" }).year).toBe("Anno non valido.");
    expect(validateForm(state).year).toBeUndefined();
  });
});
