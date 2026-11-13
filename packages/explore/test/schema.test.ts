import { describe, expect, it } from "vitest";
import {
  BookSource,
  Exploration,
  MAX_NOTEBOOK_LENGTH,
  Notebook,
  VERDICT_LABELS,
  Verdict,
  explorationIdFor,
  formatVerdict,
} from "../src/schema.ts";

const NOW = "2026-11-12T18:00:00.000Z";
const MD5 = "0123456789abcdef0123456789abcdef";

const librarySource = {
  kind: "book",
  id: "78w462eb",
  origin: "library",
  title: "The Let Them Theory",
  authors: ["Mel Robbins"],
  language: "en",
  addedAt: NOW,
  verdict: null,
};
const exploreSource = {
  kind: "book",
  id: "k3m9x2pq",
  origin: "explore",
  title: "Genealogia della morale",
  authors: ["Friedrich Nietzsche"],
  language: "it",
  epub: { fileName: "genealogia.epub", md5: MD5, bytes: 123456 },
  addedAt: NOW,
  verdict: null,
};
const exploration = {
  version: 1,
  id: "2026-11-12-nietzsche-e-la-morale-cristiana",
  title: "Nietzsche e la morale cristiana",
  question: "Che cosa dice Nietzsche della morale cristiana, e dove?",
  status: "open",
  createdAt: NOW,
  updatedAt: NOW,
  sources: [librarySource, exploreSource],
  summary: null,
  notes: [
    {
      id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4",
      body: "Appunto",
      book: "k3m9x2pq",
      createdAt: NOW,
      updatedAt: NOW,
      via: "app",
    },
  ],
  journal: [{ at: NOW, via: "skill", text: "Emerso il tema del risentimento." }],
};

describe("exploration schema", () => {
  it("accepts a well-formed exploration", () => {
    expect(Exploration.safeParse(exploration).success).toBe(true);
  });

  it("rejects unknown keys (strict objects)", () => {
    expect(Exploration.safeParse({ ...exploration, extra: 1 }).success).toBe(false);
  });

  it("rejects a bad exploration ID and a bad book ID", () => {
    expect(Exploration.safeParse({ ...exploration, id: "Nietzsche" }).success).toBe(false);
    expect(Exploration.safeParse({ ...exploration, id: "2026-11-12-Upper" }).success).toBe(false);
    const badBook = { ...librarySource, id: "iiiiiiii" };
    expect(BookSource.safeParse(badBook).success).toBe(false);
  });

  it("requires the EPUB record exactly for explore books", () => {
    expect(BookSource.safeParse({ ...exploreSource, epub: undefined }).success).toBe(false);
    expect(BookSource.safeParse({ ...librarySource, epub: exploreSource.epub }).success).toBe(false);
    expect(BookSource.safeParse(exploreSource).success).toBe(true);
  });

  it("checks the md5 format", () => {
    const epub = { ...exploreSource.epub, md5: "XYZ" };
    expect(BookSource.safeParse({ ...exploreSource, epub }).success).toBe(false);
  });

  it("requires that a note's book is one of the sources", () => {
    const bad = {
      ...exploration,
      notes: [{ ...exploration.notes[0], book: "eec5cpre" }],
    };
    const result = Exploration.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("refuses the same book twice and more than 30 sources", () => {
    expect(Exploration.safeParse({ ...exploration, sources: [librarySource, librarySource] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 31 }, (_, i) => ({
      ...librarySource,
      id: `ab${String(i).padStart(6, "0")}`,
    }));
    expect(Exploration.safeParse({ ...exploration, sources: many }).success).toBe(false);
  });

  it("refuses an empty note, an empty journal entry and a multi-line reason", () => {
    expect(Exploration.safeParse({ ...exploration, notes: [{ ...exploration.notes[0], body: "  " }] }).success).toBe(false);
    expect(Exploration.safeParse({ ...exploration, journal: [{ at: NOW, via: "cli", text: "" }] }).success).toBe(false);
    expect(
      Verdict.safeParse({ decision: "skip", reason: "riga uno\nriga due", decidedAt: NOW, via: "cli" }).success,
    ).toBe(false);
  });
});

describe("verdict schema", () => {
  const base = { reason: "Serve per il capitolo sulla colpa.", decidedAt: NOW, via: "skill" as const };

  it("sorts and deduplicates chapters", () => {
    const parsed = Verdict.parse({ ...base, decision: "parts", chapters: [5, 2, 5] });
    expect(parsed).toMatchObject({ decision: "parts", chapters: [2, 5] });
  });

  it("requires chapters for parts, and only parts may have them", () => {
    expect(Verdict.safeParse({ ...base, decision: "parts", chapters: [] }).success).toBe(false);
    expect(Verdict.safeParse({ ...base, decision: "parts" }).success).toBe(false);
    expect(Verdict.safeParse({ ...base, decision: "all", chapters: [1] }).success).toBe(false);
  });

  it("refuses chapter numbers below 1 and non-integers", () => {
    expect(Verdict.safeParse({ ...base, decision: "parts", chapters: [0] }).success).toBe(false);
    expect(Verdict.safeParse({ ...base, decision: "parts", chapters: [1.5] }).success).toBe(false);
  });

  it("accepts all, skip and undecided", () => {
    for (const decision of ["all", "skip", "undecided"]) {
      expect(Verdict.safeParse({ ...base, decision }).success).toBe(true);
    }
  });
});

describe("labels and IDs", () => {
  const verdict = (decision: "all" | "skip" | "undecided", extra = {}) =>
    ({ decision, reason: "x", decidedAt: NOW, via: "cli", ...extra }) as never;

  it("formats the verdicts in Italian", () => {
    expect(formatVerdict(verdict("all"))).toBe("Leggere tutto");
    expect(formatVerdict(verdict("skip"))).toBe("Non leggere");
    expect(formatVerdict(verdict("undecided"))).toBe("Da decidere");
    expect(formatVerdict(null)).toBe("Da decidere");
    expect(VERDICT_LABELS.parts).toBe("Leggere in parte");
  });

  it("lists the chapters of a part verdict", () => {
    const parts = (chapters: number[]) => ({ decision: "parts", chapters, reason: "x", decidedAt: NOW, via: "cli" }) as never;
    expect(formatVerdict(parts([3]))).toBe("Leggere il capitolo 3");
    expect(formatVerdict(parts([2, 5]))).toBe("Leggere i capitoli 2 e 5");
    expect(formatVerdict(parts([1, 2, 7]))).toBe("Leggere i capitoli 1, 2 e 7");
  });

  it("builds the ID from the local date and an ASCII slug", () => {
    const date = new Date(2026, 10, 12, 18, 0, 0);
    expect(explorationIdFor("Nietzsche e la morale cristiana", date)).toBe(
      "2026-11-12-nietzsche-e-la-morale-cristiana",
    );
    expect(explorationIdFor("  Perché?? Città & Stato  ", date)).toBe("2026-11-12-perche-citta-stato");
    expect(explorationIdFor("!!!", date)).toBe("2026-11-12-esplorazione");
    const long = explorationIdFor("a".repeat(100), date);
    expect(long).toBe(`2026-11-12-${"a".repeat(60)}`);
  });
});

describe("notebook schema", () => {
  const notebook = { body: "# Quaderno\n\nAppunti.", updatedAt: NOW, via: "app" };

  it("accepts an exploration with a notebook, and one without (old files stay valid)", () => {
    expect(Exploration.safeParse({ ...exploration, notebook }).success).toBe(true);
    expect(Exploration.safeParse(exploration).success).toBe(true);
  });

  it("refuses an empty notebook, a notebook over the limit and an unknown key", () => {
    expect(Notebook.safeParse({ ...notebook, body: "  \n " }).success).toBe(false);
    expect(Notebook.safeParse({ ...notebook, body: "x".repeat(MAX_NOTEBOOK_LENGTH + 1) }).success).toBe(false);
    expect(Notebook.safeParse({ ...notebook, body: "x".repeat(MAX_NOTEBOOK_LENGTH) }).success).toBe(true);
    expect(Notebook.safeParse({ ...notebook, extra: true }).success).toBe(false);
  });

  it("trims the notebook body", () => {
    expect(Notebook.parse({ ...notebook, body: "  Testo  " }).body).toBe("Testo");
  });
});
