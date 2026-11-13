// Multi-book tools of an exploration: list_chapters, read_chapter and search_book over several books with fake text.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadExploreBookText,
  multiBookTools,
  type BookSummary,
  type BookText,
  type MultiBook,
  type TextManifest,
} from "../../../src/node/explore/index.ts";

type Tools = Record<string, { execute?: (input: any, options: any) => any }>;

/** Runs a tool the way the agent does (the options are unused by these tools). */
async function run(tools: unknown, name: string, input: unknown): Promise<string> {
  const tool = (tools as Tools)[name];
  if (!tool?.execute) throw new Error(`no tool ${name}`);
  return (await tool.execute(input, { toolCallId: "t", messages: [] })) as string;
}

type FakeChapter = { n: number; title: string; body: string };

/** A fake book: its chapters in memory, and a counter of the loads. */
function fakeBook(
  id: string,
  title: string,
  chapters: FakeChapter[],
  options: { language?: string; summary?: BookSummary | null } = {},
) {
  const state = { loads: 0, failures: 0 };
  const manifest: TextManifest = {
    id,
    title,
    authors: ["Autore Fittizio"],
    generatedAt: "2026-11-12T09:00:00.000Z",
    chapters: chapters.map((c) => ({
      n: c.n,
      file: `${String(c.n).padStart(2, "0")}.md`,
      title: c.title,
      words: c.body.split(/\s+/).length,
    })),
  };
  const text: BookText = {
    manifest,
    readChapter: async (n) => {
      const chapter = chapters.find((c) => c.n === n);
      if (!chapter) throw new Error(`capitolo ${n} inesistente`);
      return chapter.body;
    },
  };
  const book: MultiBook = {
    id,
    title,
    ...(options.language !== undefined ? { language: options.language } : {}),
    summary: options.summary ?? null,
    loadText: async () => {
      state.loads++;
      return text;
    },
  };
  return { book, state };
}

/** A fake book whose text fails to load `failures` times, then works. */
function flakyBook(id: string, title: string, chapters: FakeChapter[], failures: number) {
  const inner = fakeBook(id, title, chapters);
  const state = { loads: 0, failures: 0 };
  const book: MultiBook = {
    ...inner.book,
    loadText: async () => {
      state.loads++;
      if (state.failures < failures) {
        state.failures++;
        throw new Error("disco non raggiungibile");
      }
      return inner.book.loadText();
    },
  };
  return { book, state };
}

const SUMMARY: BookSummary = {
  version: 1,
  bookId: "k3m9x2pq",
  generatedAt: "2026-11-12T10:00:00.000Z",
  model: "smart",
  language: "it",
  book: "Un saggio breve.",
  chapters: [
    { n: 1, title: "Il tempo", words: 300, summary: "Il tempo vissuto." },
    { n: 2, title: "Le abitudini", words: 500, summary: null },
  ],
} as BookSummary;

const alphaFake = () =>
  fakeBook(
    "k3m9x2pq",
    "Il giardino delle ore",
    [
      {
        n: 1,
        title: "Le ore che scivolano",
        body: "Il tempo scorre lento.\n\nLa Routine spegne il tempo.",
      },
      { n: 2, title: "Il giardiniere", body: "Annaffia ogni aiuola, poi torna alla prima." },
    ],
    { language: "it", summary: SUMMARY },
  );

const betaFake = () =>
  fakeBook(
    "a7b2c4d5",
    "Notes on Silence",
    [
      { n: 1, title: "Opening", body: "Silence is not empty.\n\nThe tempo of a room changes." },
      { n: 2, title: "Closing", body: "We return to the tempo of the street." },
    ],
    { language: "en" },
  );

/** Fresh fakes per test: their load counters are part of the assertions. */
function fresh() {
  const alpha = alphaFake();
  const beta = betaFake();
  return { alpha, beta, ALPHA: alpha, BETA: beta };
}

describe("multiBookTools: list_chapters", () => {
  it("lists the chapters of the book named by its ID, with the summary status from summary.json", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    expect(await run(tools, "list_chapters", { book: "k3m9x2pq" })).toBe(
      "1. Il tempo (300 parole) — con sintesi\n2. Le abitudini (500 parole) — senza sintesi",
    );
    expect(ALPHA.state.loads).toBe(0);
  });

  it("uses the cached manifest when the book has no summary.json", async () => {
    const { BETA } = fresh();
    const tools = multiBookTools([BETA.book]);
    const answer = await run(tools, "list_chapters", { book: "a7b2c4d5" });
    expect(answer).toContain("1. Opening");
    expect(answer).toContain("— sintesi non disponibile");
    expect(BETA.state.loads).toBe(1);
  });

  it("answers that the book has no chapters", async () => {
    const empty = fakeBook("e0e0e0e0", "Vuoto", []);
    expect(await run(multiBookTools([empty.book]), "list_chapters", { book: "e0e0e0e0" })).toBe(
      "Il libro non ha capitoli.",
    );
  });
});

describe("multiBookTools: read_chapter", () => {
  it("reads a chapter of the named book", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    expect(await run(tools, "read_chapter", { book: "a7b2c4d5", chapter: 2 })).toBe(
      "Capitolo 2 «Closing» — parte 1 di 1\n\nWe return to the tempo of the street.",
    );
  });

  it("reads the parts of a long chapter and says where the chapter continues", async () => {
    const paragraph = Array.from({ length: 100 }, (_, i) => `parola${i}`).join(" ");
    const long = fakeBook("l0l0l0l0", "Lungo", [
      {
        n: 1,
        title: "Molto lungo",
        body: Array.from({ length: 80 }, () => paragraph).join("\n\n"),
      },
    ]);
    const tools = multiBookTools([long.book]);

    const first = await run(tools, "read_chapter", { book: "l0l0l0l0", chapter: 1 });
    expect(first).toContain("parte 1 di 2");
    expect(first).toContain("chiama read_chapter con chapter=1 e part=2");

    const second = await run(tools, "read_chapter", { book: "l0l0l0l0", chapter: 1, part: 2 });
    expect(second).toContain("parte 2 di 2");
    expect(second).not.toContain("continua");

    expect(await run(tools, "read_chapter", { book: "l0l0l0l0", chapter: 1, part: 3 })).toBe(
      "Il capitolo 1 ha 2 parti: part va da 1 a 2.",
    );
  });

  it("answers an unknown chapter with the range of the book's chapters", async () => {
    const { BETA } = fresh();
    expect(
      await run(multiBookTools([BETA.book]), "read_chapter", { book: "a7b2c4d5", chapter: 9 }),
    ).toBe("Il capitolo 9 non esiste. I capitoli vanno da 1 a 2 (2 in tutto).");
  });
});

describe("multiBookTools: unknown book", () => {
  it("lists the valid IDs with their titles for every tool", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    const expected =
      "Il libro zzzzzzzz non esiste. I libri disponibili sono: k3m9x2pq («Il giardino delle ore»), a7b2c4d5 («Notes on Silence»).";
    expect(await run(tools, "list_chapters", { book: "zzzzzzzz" })).toBe(expected);
    expect(await run(tools, "read_chapter", { book: "zzzzzzzz", chapter: 1 })).toBe(expected);
    expect(await run(tools, "search_book", { book: "zzzzzzzz", query: "tempo" })).toBe(expected);
    expect(ALPHA.state.loads + BETA.state.loads).toBe(0);
  });

  it("says that the exploration has no books", async () => {
    expect(await run(multiBookTools([]), "list_chapters", { book: "k3m9x2pq" })).toBe(
      "Non ci sono libri in questa esplorazione.",
    );
  });
});

describe("multiBookTools: search_book", () => {
  it("searches one book when book is given, with the single-book wording", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    const answer = await run(tools, "search_book", { book: "k3m9x2pq", query: "tempo" });
    const lines = answer.split("\n");
    expect(lines[0]).toBe("Trovati 2 passaggi per «tempo»:");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      "- cap. 1 «Le ore che scivolano»: …Il tempo scorre lento. La Routine spegne il tempo.…",
    );
    expect(answer).not.toContain("Notes on Silence");
  });

  it("gives the no-hit note with the language of the book", async () => {
    const { BETA } = fresh();
    expect(
      await run(multiBookTools([BETA.book]), "search_book", {
        book: "a7b2c4d5",
        query: "giardino",
      }),
    ).toBe(
      "Nessun risultato per «giardino» nel libro. Prova sinonimi o la traduzione del termine: il libro può essere in un'altra lingua (lingua del libro: en).",
    );
  });

  it("searches every book without book, prefixing each hit with the title and ID", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    const answer = await run(tools, "search_book", { query: "tempo" });
    expect(answer.split("\n")[0]).toBe("Trovati 4 passaggi per «tempo»:");
    expect(answer).toContain(
      "- «Il giardino delle ore» (k3m9x2pq), cap. 1 «Le ore che scivolano»: …",
    );
    expect(answer).toContain("- «Notes on Silence» (a7b2c4d5), cap. 1 «Opening»: …");
    expect(answer).toContain("- «Notes on Silence» (a7b2c4d5), cap. 2 «Closing»: …");
  });

  it("uses the all-words heading across books when no book has the exact phrase", async () => {
    const { ALPHA, BETA } = fresh();
    const answer = await run(multiBookTools([ALPHA.book, BETA.book]), "search_book", {
      query: "tempo routine",
    });
    expect(answer).toBe(
      "Nessuna frase esatta. Ci sono 1 righe che contengono tutte le parole di «tempo routine»:\n- «Il giardino delle ore» (k3m9x2pq), cap. 1 «Le ore che scivolano»: …Il tempo scorre lento. La Routine spegne il tempo.…",
    );
  });

  it("keeps only the exact-phrase hits when some book has the phrase", async () => {
    const { ALPHA, BETA } = fresh();
    const answer = await run(multiBookTools([ALPHA.book, BETA.book]), "search_book", {
      query: "tempo routine",
    });
    expect(answer).not.toContain("Notes on Silence");
    const phrase = await run(multiBookTools([ALPHA.book, BETA.book]), "search_book", {
      query: "Routine spegne",
    });
    expect(phrase.split("\n")[0]).toBe("Trovati 1 passaggi per «Routine spegne»:");
  });

  it("answers no hit across all books in one sentence", async () => {
    const { ALPHA, BETA } = fresh();
    expect(
      await run(multiBookTools([ALPHA.book, BETA.book]), "search_book", { query: "balena" }),
    ).toBe(
      "Nessun risultato per «balena» in nessuno dei libri. Prova sinonimi o la traduzione del termine: i libri possono essere in un'altra lingua.",
    );
  });

  it("names a book whose text fails to load and still searches the others", async () => {
    const { BETA } = fresh();
    const broken = flakyBook("f1f1f1f1", "Rotto", [{ n: 1, title: "Uno", body: "tempo rotto" }], 5);
    const answer = await run(multiBookTools([broken.book, BETA.book]), "search_book", {
      query: "tempo",
    });
    expect(answer).toContain("- «Notes on Silence» (a7b2c4d5), cap. 1 «Opening»");
    expect(answer).toContain(
      "Testo non disponibile per:\n- «Rotto» (f1f1f1f1): disco non raggiungibile",
    );
  });

  it("answers with the text error when every book fails to load", async () => {
    const broken = flakyBook("f1f1f1f1", "Rotto", [{ n: 1, title: "Uno", body: "tempo" }], 5);
    expect(await run(multiBookTools([broken.book]), "search_book", { query: "tempo" })).toBe(
      "Testo del libro non disponibile: disco non raggiungibile",
    );
  });
});

describe("multiBookTools: loading", () => {
  it("loads each book's text once across calls", async () => {
    const { ALPHA, BETA } = fresh();
    const tools = multiBookTools([ALPHA.book, BETA.book]);
    await run(tools, "read_chapter", { book: "a7b2c4d5", chapter: 1 });
    await run(tools, "search_book", { query: "tempo" });
    await run(tools, "read_chapter", { book: "a7b2c4d5", chapter: 2 });
    expect(BETA.state.loads).toBe(1);
    expect(ALPHA.state.loads).toBe(1);
  });

  it("retries a failed load on the next call", async () => {
    const flaky = flakyBook("f1f1f1f1", "Instabile", [{ n: 1, title: "Uno", body: "testo" }], 1);
    const tools = multiBookTools([flaky.book]);
    expect(await run(tools, "read_chapter", { book: "f1f1f1f1", chapter: 1 })).toBe(
      "Testo del libro non disponibile: disco non raggiungibile",
    );
    expect(await run(tools, "read_chapter", { book: "f1f1f1f1", chapter: 1 })).toContain(
      "Capitolo 1 «Uno» — parte 1 di 1",
    );
    expect(flaky.state.loads).toBe(2);
  });
});

describe("loadExploreBookText", () => {
  it("says in Italian how to import the EPUB again when the text is not cached", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ehub-explore-text-"));
    try {
      await expect(loadExploreBookText("k3m9x2pq", { cacheDir })).rejects.toThrow(
        "Il testo del libro k3m9x2pq non è in cache: ricarica l'EPUB con pnpm explore add k3m9x2pq --epub <file>.",
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
