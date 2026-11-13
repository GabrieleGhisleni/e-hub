import type { Exploration } from "../../src/schema.ts";

export const EXPLORATION_ID = "2026-11-12-nietzsche-e-la-morale-cristiana";

/** An exploration with one library book (verdict: two chapters) and one explore-only EPUB (no verdict yet). */
export function sampleExploration(overrides: Partial<Exploration> = {}): Exploration {
  return {
    version: 1,
    id: EXPLORATION_ID,
    title: "Nietzsche e la morale cristiana",
    question: "Che cosa dice Nietzsche della morale cristiana, e dove?",
    status: "open",
    createdAt: "2026-11-12T18:00:00.000Z",
    updatedAt: "2026-11-12T18:00:00.000Z",
    sources: [
      {
        kind: "book",
        id: "eec5cpre",
        origin: "library",
        title: "Also Sprach Zarathustra",
        authors: ["Friedrich Nietzsche"],
        language: "de",
        addedAt: "2026-11-12T18:00:00.000Z",
        verdict: {
          decision: "parts",
          chapters: [2, 5],
          reason: "Due capitoli sulla morale.",
          decidedAt: "2026-11-12T18:10:00.000Z",
          via: "skill",
        },
      },
      {
        kind: "book",
        id: "k3m9x2pq",
        origin: "explore",
        title: "Genealogia della morale",
        authors: ["Friedrich Nietzsche"],
        language: "it",
        epub: { fileName: "genealogia.epub", md5: "0123456789abcdef0123456789abcdef", bytes: 1234 },
        addedAt: "2026-11-12T18:00:00.000Z",
        verdict: null,
      },
    ],
    summary: null,
    notes: [],
    journal: [],
    ...overrides,
  };
}

/** A second exploration that also uses the library book `eec5cpre`, with "all" as verdict. */
export function otherExploration(): Exploration {
  return sampleExploration({
    id: "2026-11-10-zarathustra",
    title: "Zarathustra in breve",
    question: "Chi parla nel libro?",
    createdAt: "2026-11-10T09:00:00.000Z",
    sources: [
      {
        kind: "book",
        id: "eec5cpre",
        origin: "library",
        title: "Also Sprach Zarathustra",
        authors: ["Friedrich Nietzsche"],
        language: "de",
        addedAt: "2026-11-10T09:00:00.000Z",
        verdict: { decision: "all", reason: "Tutto.", decidedAt: "2026-11-10T09:05:00.000Z", via: "app" },
      },
    ],
  });
}
