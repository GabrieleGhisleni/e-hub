// The exploration chat source: prompt, lazy and memoized text, the tools, and propose_verdicts. No real library and
// no LLM: the dependencies are fakes, and the last test runs the HTTP chat app against the mock LLM.
import { afterEach, describe, expect, it } from "vitest";
import { createChatApp } from "@ehub/chat/server";
import { createLlm, loadAiConfig, type ToolSet } from "@ehub/chat/node";
import { startMockLlm, type MockLlm } from "@ehub/chat/testing";
import type { BookSummary, BookText, TextManifest } from "@ehub/library/explore";
import { createExplorationChatSource, type ExplorationChatDeps } from "../src/chat/index.ts";
import { NOTEBOOK_PROPOSAL_MESSAGE, ProposeNotebookInput } from "../src/chat/notebook.ts";
import { PROPOSAL_ACCEPTED_MESSAGE, ProposeVerdictsInput, checkVerdictProposal } from "../src/chat/proposal.ts";
import { ExploreError } from "../src/node/index.ts";
import type { BookSource, Exploration } from "../src/schema.ts";

const EXPLORATION_ID = "2026-11-12-nietzsche-e-la-morale-cristiana";
const LET_THEM = "78w462eb";
const ZARATHUSTRA = "eec5cpre";
const GENEALOGY = "k3m9x2pq";

const sources: BookSource[] = [
  {
    kind: "book",
    id: LET_THEM,
    origin: "library",
    title: "The Let Them Theory",
    authors: ["Mel Robbins"],
    language: "en",
    addedAt: "2026-11-12T18:00:00.000Z",
    verdict: {
      decision: "parts",
      chapters: [2, 5],
      reason: "Solo le parti sul controllo.",
      decidedAt: "2026-11-12T18:10:00.000Z",
      via: "skill",
    },
  },
  {
    kind: "book",
    id: ZARATHUSTRA,
    origin: "library",
    title: "Also Sprach Zarathustra",
    authors: ["Friedrich Nietzsche"],
    language: "de",
    addedAt: "2026-11-12T18:00:00.000Z",
    verdict: null,
  },
  {
    kind: "book",
    id: GENEALOGY,
    origin: "explore",
    title: "Genealogia della morale",
    authors: ["Friedrich Nietzsche"],
    language: "it",
    epub: { fileName: "genealogia.epub", md5: "0".repeat(32), bytes: 1234 },
    addedAt: "2026-11-12T18:05:00.000Z",
    verdict: null,
  },
];

const exploration: Exploration = {
  version: 1,
  id: EXPLORATION_ID,
  title: "Nietzsche e la morale cristiana",
  question: "Che cosa dice Nietzsche della morale cristiana, e dove?",
  status: "open",
  createdAt: "2026-11-12T18:00:00.000Z",
  updatedAt: "2026-11-12T18:30:00.000Z",
  sources,
  summary: null,
  notes: [
    {
      id: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4",
      body: "Il ressentimento compare già nella prefazione.",
      book: GENEALOGY,
      createdAt: "2026-11-12T18:20:00.000Z",
      updatedAt: "2026-11-12T18:20:00.000Z",
      via: "app",
    },
    {
      id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      body: "Confrontare i due libri sul concetto di colpa.",
      createdAt: "2026-11-12T18:25:00.000Z",
      updatedAt: "2026-11-12T18:25:00.000Z",
      via: "skill",
    },
  ],
  journal: [
    { at: "2026-11-12T18:10:00.000Z", via: "skill", text: "Triage iniziale: due libri con capitoli utili." },
    { at: "2026-11-12T18:40:00.000Z", via: "app", text: "Resta da leggere il secondo capitolo di Zarathustra." },
  ],
};

const summary: BookSummary = {
  version: 1,
  bookId: LET_THEM,
  generatedAt: "2026-11-12T00:00:00.000Z",
  model: "smart",
  language: "it",
  book: "Un libro sul controllo di ciò che dipende da noi.",
  chapters: [
    { n: 1, title: "Introduzione", words: 900, summary: "Presenta la tesi del libro." },
    { n: 2, title: "Lascia che accada", words: 2400, summary: null },
  ],
};

const zarathustraManifest: TextManifest = {
  id: ZARATHUSTRA,
  title: "Also Sprach Zarathustra",
  authors: ["Friedrich Nietzsche"],
  generatedAt: "2026-11-12T00:00:00.000Z",
  chapters: [
    { n: 1, file: "01.md", title: "Prefazione", words: 800 },
    { n: 2, file: "02.md", title: "Dei disprezzatori del corpo", words: 3000 },
  ],
};

/** Fake dependencies: the exploration on "disk", a summary for the first library book, one cached manifest. */
function fakeDeps() {
  const loads: string[] = [];
  const reads: string[] = [];
  const deps: Partial<ExplorationChatDeps> = {
    readExploration: async (id) => {
      reads.push(id);
      if (id !== EXPLORATION_ID) throw new ExploreError("not-found", "Esplorazione non trovata.");
      return exploration;
    },
    readLibraryBookSummary: async (id) => (id === LET_THEM ? summary : null),
    readCachedBookManifest: async (_origin, id) => (id === ZARATHUSTRA ? zarathustraManifest : undefined),
    loadBookText: async (origin, id) => {
      loads.push(`${origin}:${id}`);
      const text: BookText = {
        manifest: zarathustraManifest,
        readChapter: async (n) => `Testo del capitolo ${n} di ${id}.`,
      };
      return text;
    },
  };
  return { deps, loads, reads };
}

/** Runs a tool's execute with fake call options (the tests do not go through the model). */
async function callTool(tools: ToolSet, name: string, input: unknown): Promise<string> {
  const tool = tools[name] as unknown as { execute: (input: unknown, options: unknown) => unknown };
  return (await tool.execute(input, { toolCallId: "t", messages: [] })) as string;
}

describe("createExplorationChatSource: resolution", () => {
  it("returns undefined for an invalid ID without reading anything", async () => {
    const { deps, reads } = fakeDeps();
    const source = createExplorationChatSource(deps);
    expect(await source("../../etc/passwd")).toBeUndefined();
    expect(await source("")).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("returns undefined for an exploration that does not exist", async () => {
    const source = createExplorationChatSource(fakeDeps().deps);
    expect(await source("2026-11-12-altra-esplorazione")).toBeUndefined();
  });

  it("rethrows errors that are not about the ID", async () => {
    const source = createExplorationChatSource({
      ...fakeDeps().deps,
      readExploration: async () => {
        throw new ExploreError("invalid-file", "File rotto.");
      },
    });
    await expect(source(EXPLORATION_ID)).rejects.toThrow("File rotto.");
  });
});

describe("createExplorationChatSource: prompt", () => {
  it("contains the question, the status, and every book with its ID, metadata and verdict", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    const system = source!.system;

    expect(system).toContain("Domanda: Che cosa dice Nietzsche della morale cristiana, e dove?");
    expect(system).toContain("Stato: aperta");
    expect(system).toContain(`«The Let Them Theory» (ID ${LET_THEM})`);
    expect(system).toContain("- Autori: Mel Robbins");
    expect(system).toContain("- Lingua: en");
    expect(system).toContain("- Origine: in libreria");
    expect(system).toContain("- Origine: solo da esplorare");
    expect(system).toContain("- Verdetto attuale: Leggere i capitoli 2 e 5 — Solo le parti sul controllo.");
    expect(system).toContain("- Verdetto attuale: nessun verdetto");
    expect(source!.tokens).toBeGreaterThan(0);
  });

  it("uses the book summary and its chapter summaries when summary.json exists", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain("Sintesi del libro:\nUn libro sul controllo di ciò che dipende da noi.");
    expect(system).toContain("1. Introduzione (900 parole)\n   Presenta la tesi del libro.");
    expect(system).toContain("2. Lascia che accada (2400 parole)\n   (nessuna sintesi)");
  });

  it("falls back to the cached manifest chapters, then to the hint to use list_chapters", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain("- Capitoli (senza sintesi):\n  1. Prefazione (800 parole)\n  2. Dei disprezzatori del corpo (3000 parole)");
    expect(system).toContain("(capitoli non ancora disponibili: usa list_chapters)");
  });

  it("names the book of each note and shows the journal oldest first, with date and origin", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain(`- [«Genealogia della morale» (${GENEALOGY})] Il ressentimento compare già nella prefazione.`);
    expect(system).toContain("- [generale] Confrontare i due libri sul concetto di colpa.");
    expect(system).toContain("## Diario delle sessioni precedenti");
    const first = system.indexOf("2026-11-12 18:10 (skill): Triage iniziale");
    const second = system.indexOf("2026-11-12 18:40 (app): Resta da leggere");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("tells the model to triage, to read before claiming, and to propose verdicts without saving", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain("Il triage viene prima della lettura");
    expect(system).toContain("LEGGI i capitoli pertinenti");
    expect(system).toContain("(«Titolo breve», cap. N)");
    expect(system).toContain("al massimo due frasi");
    expect(system).toContain("chiama propose_verdicts");
    expect(system).toContain("NON viene salvata");
  });

  it("shows the whole notebook after the summary, or «Vuoto.» when there is none", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain("## Quaderno\nVuoto.\n");
    expect(system.indexOf("## Sintesi dell'esplorazione")).toBeLessThan(system.indexOf("## Quaderno"));
    expect(system.indexOf("## Quaderno")).toBeLessThan(system.indexOf("## Note"));

    const { deps } = fakeDeps();
    const base = await deps.readExploration!(EXPLORATION_ID);
    const withBook = createExplorationChatSource({
      ...deps,
      readExploration: async () => ({
        ...base,
        notebook: { body: "**Tesi** (cap. 2)\n\nIl ressentimento è il filo rosso.", updatedAt: base.updatedAt, via: "app" },
      }),
    });
    const notebook = (await withBook(EXPLORATION_ID))!.system;
    expect(notebook).toContain("## Quaderno\n**Tesi** (cap. 2)\n\nIl ressentimento è il filo rosso.\n");
    expect(notebook).not.toContain("Vuoto.");
  });

  it("tells the model how to use the notebook: save_note to add, propose_notebook to rewrite", async () => {
    const system = (await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID))!.system;
    expect(system).toContain("Il Quaderno è il documento di appunti condiviso");
    expect(system).toContain("chiama save_note");
    expect(system).toContain("chiama propose_notebook con il testo COMPLETO");
    expect(system).toContain("non salva nulla");
    expect(system).toContain("Non togliere mai contenuto dal Quaderno");
  });
});

describe("createExplorationChatSource: tools and text", () => {
  it("offers the multi-book tools and propose_verdicts", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    expect(Object.keys(source!.tools!).sort()).toEqual(
      ["list_chapters", "propose_notebook", "propose_verdicts", "read_chapter", "search_book"].sort(),
    );
  });

  it("loads the text lazily and at most once per book, across calls and across requests", async () => {
    const { deps, loads } = fakeDeps();
    const source = createExplorationChatSource(deps);

    const first = await source(EXPLORATION_ID);
    expect(loads).toEqual([]);

    // The summary answers list_chapters without the text.
    expect(await callTool(first!.tools!, "list_chapters", { book: LET_THEM })).toContain("con sintesi");
    expect(loads).toEqual([]);

    expect(await callTool(first!.tools!, "read_chapter", { book: ZARATHUSTRA, chapter: 1 })).toContain(
      "Capitolo 1 «Prefazione» — parte 1 di 1",
    );
    expect(await callTool(first!.tools!, "read_chapter", { book: ZARATHUSTRA, chapter: 2 })).toContain(
      "Testo del capitolo 2",
    );

    // A second request for the same exploration reuses the loaded text.
    const second = await source(EXPLORATION_ID);
    await callTool(second!.tools!, "read_chapter", { book: ZARATHUSTRA, chapter: 1 });
    expect(loads).toEqual([`library:${ZARATHUSTRA}`]);
  });

  it("answers an unknown book ID with the valid ones", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    const reply = await callTool(source!.tools!, "list_chapters", { book: "zzzzzzzz" });
    expect(reply).toContain("Il libro zzzzzzzz non esiste");
    expect(reply).toContain(LET_THEM);
  });
});

describe("propose_verdicts", () => {
  const valid = {
    verdicts: [
      { book: LET_THEM, decision: "parts", chapters: [5, 2], reason: "Solo il controllo." },
      { book: GENEALOGY, decision: "all", reason: "Il testo breve va letto tutto." },
    ],
    summary: "Il ressentimento è il filo rosso.",
    journal: "Resta da confrontare Zarathustra.",
  };

  it("answers that the proposal is shown and nothing is saved", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    expect(await callTool(source!.tools!, "propose_verdicts", valid)).toBe(PROPOSAL_ACCEPTED_MESSAGE);
    expect(PROPOSAL_ACCEPTED_MESSAGE).toBe("Proposta mostrata all'utente: si salva solo dopo la sua conferma.");
  });

  it("lists the problems in Italian, with the valid IDs, so the model can retry", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    const reply = await callTool(source!.tools!, "propose_verdicts", {
      verdicts: [
        { book: "zzzzzzzz", decision: "skip", reason: "No." },
        { book: ZARATHUSTRA, decision: "parts", reason: "Forse." },
        { book: GENEALOGY, decision: "all", chapters: [1], reason: "Tutto." },
        { book: GENEALOGY, decision: "skip", reason: "Doppio." },
      ],
    });
    expect(reply).toContain("La proposta non è valida:");
    expect(reply).toContain(`il libro zzzzzzzz non è una fonte di questa esplorazione. Le fonti sono: ${LET_THEM}`);
    expect(reply).toContain("per il libro eec5cpre il verdetto «parts» richiede almeno un capitolo");
    expect(reply).toContain("per il libro k3m9x2pq i capitoli si indicano solo con il verdetto «parts»");
    expect(reply).toContain("il libro k3m9x2pq compare più di una volta");
    expect(reply).toContain("Correggi la proposta");
  });

  it("validates the input shape with the schema the web UI uses too", () => {
    expect(ProposeVerdictsInput.safeParse({ verdicts: [] }).success).toBe(false);
    expect(
      ProposeVerdictsInput.safeParse({ verdicts: [{ book: LET_THEM, decision: "maybe", reason: "x" }] }).success,
    ).toBe(false);
    expect(
      ProposeVerdictsInput.safeParse({ verdicts: [{ book: LET_THEM, decision: "all", reason: "due\nrighe" }] }).success,
    ).toBe(false);
    const parsed = ProposeVerdictsInput.parse(valid);
    expect(checkVerdictProposal(parsed, [{ id: LET_THEM, title: "x" }, { id: GENEALOGY, title: "y" }])).toEqual([]);
  });
});

describe("propose_notebook", () => {
  it("answers that the proposal is shown and not saved yet", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    const reply = await callTool(source!.tools!, "propose_notebook", { body: "**Tesi**\n\nTesto riscritto." });
    expect(reply).toBe(NOTEBOOK_PROPOSAL_MESSAGE);
    expect(reply).toContain("Non è ancora stata salvata");
  });

  it("refuses an empty text, with the reason, so the model can retry", async () => {
    const source = await createExplorationChatSource(fakeDeps().deps)(EXPLORATION_ID);
    const reply = await callTool(source!.tools!, "propose_notebook", { body: "   " });
    expect(reply).toContain("Il quaderno proposto non è valido");
    expect(reply).toContain("Correggi la proposta");
  });

  it("validates the input with the schema the web card uses too", () => {
    expect(ProposeNotebookInput.safeParse({ body: "Un testo." }).success).toBe(true);
    expect(ProposeNotebookInput.safeParse({ body: "  " }).success).toBe(false);
    expect(ProposeNotebookInput.safeParse({ body: "x".repeat(100_001) }).success).toBe(false);
    expect(ProposeNotebookInput.safeParse({ body: "ok", extra: 1 }).success).toBe(false);
  });
});

describe("POST /api/chat with an exploration source", () => {
  let mock: MockLlm | undefined;
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it("resolves the exploration and sends its prompt to the model; 404 for an unknown one", async () => {
    mock = await startMockLlm([{ text: "Inizia dal libro sulla colpa." }]);
    const source = createExplorationChatSource(fakeDeps().deps);
    const app = createChatApp({
      getLlm: () => createLlm(loadAiConfig({ EHUB_AI_BASE_URL: mock!.baseURL, EHUB_AI_API_KEY: "test-key" })),
      resolveSource: (ref) => (ref.kind === "exploration" ? source(ref.id) : Promise.resolve(undefined)),
    });
    const post = (id: string) =>
      app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "conv-x",
          source: { kind: "exploration", id },
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Da dove comincio?" }] }],
        }),
      });

    const ok = await post(EXPLORATION_ID);
    expect(ok.status).toBe(200);
    await ok.text();
    expect(mock.requests[0].messages[0]).toMatchObject({ role: "system" });
    expect(mock.requests[0].messages[0].content).toContain("Domanda: Che cosa dice Nietzsche");
    expect(mock.requests[0].tools.map((t: { function: { name: string } }) => t.function.name)).toContain(
      "propose_verdicts",
    );

    const missing = await post("2026-11-12-altra-esplorazione");
    expect(missing.status).toBe(404);
  });
});
