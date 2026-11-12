/** Mock model and fixtures for the summary tests: a scripted `LanguageModel` (no HTTP) and a book with a text cache. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LanguageModel } from "@ehub/chat/node";
import type { TextManifest } from "../../../src/node/text/index.ts";
import type { BookSummary } from "../../../src/shared/schema.ts";
import { countWords } from "../../../src/node/text/markdown.ts";
import { writeBook } from "../../../src/node/repo/index.ts";
import type { TestEnv } from "../../helpers/index.ts";

export interface ModelCall {
  system: string;
  /** Text of the user messages, joined. */
  user: string;
  /** `providerOptions` the SDK passed to the model (undefined when none). */
  providerOptions: Record<string, unknown> | undefined;
}

/** A reply: the text, optionally with the router's `x-router-model` header, or an error to throw. */
export type Reply = string | { text: string; routerModel?: string } | Error;

export interface ScriptedModel {
  model: LanguageModel;
  calls: ModelCall[];
  /** Highest number of calls in flight at the same time. */
  maxInFlight(): number;
}

/**
 * Mock model. `reply` gets each call (in arrival order) and says what it answers. `delayMs` keeps calls in flight
 * (concurrency tests). `gate`, when given, holds every call until it resolves.
 */
export function scriptedModel(
  reply: (call: ModelCall, index: number) => Reply,
  options: { delayMs?: number; gate?: Promise<void> } = {},
): ScriptedModel {
  const calls: ModelCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  };
  const provider = {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock-summary",
    supportedUrls: {},
    doGenerate: async (request: {
      prompt: Array<{ role: string; content: unknown }>;
      providerOptions?: Record<string, unknown>;
    }) => {
      const system = String(request.prompt.find((m) => m.role === "system")?.content ?? "");
      const user = request.prompt
        .filter((m) => m.role === "user")
        .map((m) =>
          Array.isArray(m.content)
            ? m.content.map((p: { text?: string }) => p.text ?? "").join("")
            : String(m.content),
        )
        .join("\n");
      const call = { system, user, providerOptions: request.providerOptions };
      const index = calls.length;
      calls.push(call);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (options.gate) await options.gate;
        if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        const answer = reply(call, index);
        if (answer instanceof Error) throw answer;
        const { text, routerModel } =
          typeof answer === "string" ? { text: answer, routerModel: undefined } : answer;
        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
          response: {
            id: `resp-${index}`,
            timestamp: new Date(0),
            modelId: "mock-summary",
            headers: routerModel ? { "x-router-model": routerModel } : {},
          },
        };
      } finally {
        inFlight -= 1;
      }
    },
    doStream: async () => {
      throw new Error("doStream is not used by the summarizer");
    },
  };
  return {
    model: provider as unknown as LanguageModel,
    calls,
    maxInFlight: () => maxInFlight,
  };
}

/** `count` words of Italian-looking filler, in paragraphs of about 100 words. Distinct per `seed`. */
export function prose(count: number, seed: string): string {
  const words = ["il", "tempo", "libro", "idea", "capitolo", "lettura", "mente", "parola", "storia", "mondo"];
  const paragraphs: string[] = [];
  let produced = 0;
  let p = 0;
  while (produced < count) {
    const size = Math.min(100, count - produced);
    const tokens: string[] = [];
    for (let i = 0; i < size; i++) tokens.push(words[(i + p * 3 + seed.length) % words.length]!);
    tokens[0] = `${seed}${tokens[0]}`;
    paragraphs.push(`${tokens.join(" ")}.`);
    produced += size;
    p += 1;
  }
  return paragraphs.join("\n\n");
}

export interface SeedChapter {
  title: string;
  /** Words of body text (the heading is extra). */
  words: number;
  /** Body text; defaults to `prose(words, title)`. */
  text?: string;
}

/**
 * A book in the repo (book.json) and its text in the cache (`books/<id>/text/` with manifest.json and one Markdown file
 * per chapter), so `extractBookText` finds the text and never touches Drive.
 */
export async function seedBook(
  env: Pick<TestEnv, "dataDir" | "cacheDir">,
  id: string,
  chapters: SeedChapter[],
  book: { title?: string; description?: string } = {},
): Promise<void> {
  await writeBook(env.dataDir, {
    id,
    title: book.title ?? "Il giardino delle ore",
    authors: ["Ada Esempio", "Luca Prova"],
    topic: "saggistica",
    status: "to-read",
    ...(book.description ? { description: book.description } : {}),
  });
  const textDir = path.join(env.cacheDir, "books", id, "text");
  await mkdir(textDir, { recursive: true });
  const manifest: TextManifest = {
    id,
    title: book.title ?? "Il giardino delle ore",
    authors: ["Ada Esempio", "Luca Prova"],
    generatedAt: "2026-11-12T10:00:00.000Z",
    chapters: [],
  };
  for (const [i, chapter] of chapters.entries()) {
    const n = i + 1;
    const body = chapter.text ?? prose(chapter.words, chapter.title);
    const markdown = `# ${chapter.title}\n\n${body}\n`;
    const file = `${String(n).padStart(2, "0")}-capitolo-${n}.md`;
    await writeFile(path.join(textDir, file), markdown);
    manifest.chapters.push({ n, file, title: chapter.title, words: countWords(markdown) });
  }
  await writeFile(path.join(textDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A valid summary of book `ID` (overridable). */
export function sampleSummary(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    version: 1,
    bookId: "aaaaaaaa",
    generatedAt: "2026-11-12T10:00:00.000Z",
    model: "smart",
    language: "it",
    book: "Un saggio breve sul tempo.",
    chapters: [
      { n: 1, title: "Copertina", words: 12, summary: null },
      { n: 2, title: "Le ore", words: 900, summary: "Il tempo vissuto si allunga." },
    ],
    ...overrides,
  };
}

