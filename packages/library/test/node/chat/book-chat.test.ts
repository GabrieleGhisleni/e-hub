// Book chat source: prompt, lazy text, the three tools (read_chapter parts, search_book) and an end-to-end run
// through createChatApp with the HTTP mock LLM.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLlm, estimateTokens, loadAiConfig } from "@ehub/chat/node";
import { createChatApp } from "@ehub/chat/server";
import type { ChatRequestBody } from "@ehub/chat/shared";
import { createBookChatSource, type BookText } from "../../../src/node/chat/index.ts";
import type { TextManifest } from "../../../src/node/text/index.ts";
import { startMockLlm, type MockLlm } from "@ehub/chat/testing";

const FIXTURE = path.resolve(import.meta.dirname, "../../../../chat/test/fixtures/books/fx000001");

let dataDir: string;
let mock: MockLlm | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "ehub-book-chat-"));
  const bookDir = path.join(dataDir, "books", "fx000001");
  mkdirSync(bookDir, { recursive: true });
  copyFileSync(path.join(FIXTURE, "book.json"), path.join(bookDir, "book.json"));
  copyFileSync(path.join(FIXTURE, "summary.json"), path.join(bookDir, "summary.json"));
});

afterEach(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  await mock?.close();
  mock = undefined;
});

/** Text provider over the fixture's chapter files, counting its calls. */
function fixtureText() {
  const state = { calls: 0 };
  const manifest = JSON.parse(
    readFileSync(path.join(FIXTURE, "text", "manifest.json"), "utf8"),
  ) as TextManifest;
  const text: BookText = {
    manifest,
    readChapter: async (n) => {
      const chapter = manifest.chapters.find((c) => c.n === n)!;
      return readFile(path.join(FIXTURE, "text", chapter.file), "utf8");
    },
  };
  return {
    state,
    getBookText: async () => {
      state.calls++;
      return text;
    },
  };
}

/** Chat source for the fixture book; the cached manifest is not on disk, so the no-summary branch sees none. */
function source(getBookText = fixtureText().getBookText) {
  return createBookChatSource({ dataDir, getBookText, readCachedManifest: async () => undefined });
}

type Tools = Record<string, { execute?: (input: any, options: any) => any }>;

/** Runs a tool of the context the way the agent does (the options are unused by the book tools). */
async function run(tools: unknown, name: string, input: unknown): Promise<string> {
  const tool = (tools as Tools)[name];
  if (!tool?.execute) throw new Error(`no tool ${name}`);
  return (await tool.execute(input, { toolCallId: "t", messages: [] })) as string;
}

describe("createBookChatSource: resolution", () => {
  it("returns undefined for an unknown book and for an invalid id", async () => {
    const resolve = source();
    expect(await resolve("zzzzzzzz")).toBeUndefined();
    expect(await resolve("../etc")).toBeUndefined();
    expect(await resolve("fx")).toBeUndefined();
  });

  it("does not load the text to resolve a book with a summary", async () => {
    const provider = fixtureText();
    const context = await source(provider.getBookText)("fx000001");
    expect(context).toBeDefined();
    expect(provider.state.calls).toBe(0);
  });
});

describe("book prompt", () => {
  it("has the metadata, the book summary, every chapter summary and the rules", async () => {
    const context = (await source()("fx000001"))!;
    const system = context.system;

    expect(system).toContain("Il giardino delle ore");
    expect(system).toContain("Autore Fittizio");
    expect(system).toContain("Libro inventato per i test della chat");
    expect(system).toContain("Saggio breve che lega la percezione del tempo");
    expect(system).toContain("1. Le ore che scivolano (412 parole)");
    expect(system).toContain("Distingue il tempo dell'orologio dal tempo vissuto");
    expect(system).toContain("3. Abitudini che fioriscono (467 parole)");
    expect(system).toContain("(cap. N)");
    expect(system).toContain("LEGGI");
    expect(system).toContain("read_chapter");
    expect(system).toContain("Rispondi nella lingua");
    expect(context.tokens).toBe(estimateTokens(system));
  });

  it("says that summaries are missing and lists the cached chapters when there is no summary.json", async () => {
    rmSync(path.join(dataDir, "books", "fx000001", "summary.json"));
    const manifest = JSON.parse(
      readFileSync(path.join(FIXTURE, "text", "manifest.json"), "utf8"),
    ) as TextManifest;
    const resolve = createBookChatSource({
      dataDir,
      getBookText: fixtureText().getBookText,
      readCachedManifest: async () => manifest,
    });

    const system = (await resolve("fx000001"))!.system;
    expect(system).toContain("Le sintesi non sono disponibili per questo libro");
    expect(system).toContain("2. Il giardiniere distratto (538 parole)");
    expect(system).not.toContain("Distingue il tempo");
  });

  it("points to list_chapters when there is no summary.json and no cached text", async () => {
    rmSync(path.join(dataDir, "books", "fx000001", "summary.json"));
    const system = (await createBookChatSource({
      dataDir,
      getBookText: fixtureText().getBookText,
      readCachedManifest: async () => undefined,
    })("fx000001"))!.system;
    expect(system).toContain("Le sintesi non sono disponibili");
    expect(system).toContain("usa list_chapters");
  });

  it("marks chapters without a summary as accessory or without summary", async () => {
    writeFileSync(
      path.join(dataDir, "books", "fx000001", "summary.json"),
      JSON.stringify({
        version: 1,
        bookId: "fx000001",
        generatedAt: "2026-11-12T10:00:00.000Z",
        model: "smart",
        language: "it",
        book: "Breve.",
        chapters: [
          { n: 1, title: "Ringraziamenti", words: 300, summary: null },
          { n: 2, title: "Il giardiniere", words: 500, summary: null },
        ],
      }),
    );
    const system = (await source()("fx000001"))!.system;
    expect(system).toContain("1. Ringraziamenti (300 parole)\n   (parte accessoria)");
    expect(system).toContain("2. Il giardiniere (500 parole)\n   (nessuna sintesi)");
  });
});

describe("book tools", () => {
  it("list_chapters numbers the chapters and says which have a summary, without loading the text", async () => {
    const provider = fixtureText();
    const tools = (await source(provider.getBookText)("fx000001"))!.tools;
    const list = await run(tools, "list_chapters", {});

    expect(list).toContain("1. Le ore che scivolano (412 parole) — con sintesi");
    expect(list).toContain("3. Abitudini che fioriscono (467 parole) — con sintesi");
    expect(provider.state.calls).toBe(0);
  });

  it("read_chapter returns a short chapter in one part, without a continuation line", async () => {
    const tools = (await source()("fx000001"))!.tools;
    const text = await run(tools, "read_chapter", { chapter: 1 });

    expect(text.startsWith("Capitolo 1 «Le ore che scivolano» — parte 1 di 1")).toBe(true);
    expect(text).toContain('Chiamo "tempo vissuto" questa misura interiore.');
    expect(text).not.toContain("continua");
  });

  it("read_chapter splits a long chapter into parts at paragraph boundaries and names the next part", async () => {
    const paragraph = Array.from({ length: 100 }, (_, i) => `parola${i}`).join(" "); // 100 words
    const longChapter = Array.from({ length: 150 }, () => paragraph).join("\n\n"); // 15000 words, 3 parts
    const manifest: TextManifest = {
      id: "fx000001",
      title: "Lungo",
      authors: ["A"],
      generatedAt: "2026-11-12T10:00:00.000Z",
      chapters: [{ n: 1, file: "01.md", title: "Lungo", words: 15000 }],
    };
    const tools = (await source(async () => ({ manifest, readChapter: async () => longChapter }))(
      "fx000001",
    ))!.tools;

    const first = await run(tools, "read_chapter", { chapter: 1 });
    expect(first.split("\n")[0]).toBe("Capitolo 1 «Lungo» — parte 1 di 3");
    expect(first).toContain("read_chapter con chapter=1 e part=2");

    const second = await run(tools, "read_chapter", { chapter: 1, part: 2 });
    expect(second.split("\n")[0]).toBe("Capitolo 1 «Lungo» — parte 2 di 3");

    const last = await run(tools, "read_chapter", { chapter: 1, part: 3 });
    expect(last.split("\n")[0]).toBe("Capitolo 1 «Lungo» — parte 3 di 3");
    expect(last).not.toContain("continua");

    expect(await run(tools, "read_chapter", { chapter: 1, part: 4 })).toContain("va da 1 a 3");
  });

  it("read_chapter explains an unknown chapter with the valid range", async () => {
    const tools = (await source()("fx000001"))!.tools;
    expect(await run(tools, "read_chapter", { chapter: 9 })).toBe(
      "Il capitolo 9 non esiste. I capitoli vanno da 1 a 3 (3 in tutto).",
    );
  });

  it("search_book finds a phrase and cites the chapter", async () => {
    const tools = (await source()("fx000001"))!.tools;
    const result = await run(tools, "search_book", { query: "regola dell'unica aiuola" });

    expect(result).toContain("Trovati 1 passaggi");
    expect(result).toContain("- cap. 2 «Il giardiniere distratto»:");
    expect(result).toContain("La regola dell'unica aiuola");
  });

  it("search_book ignores case and accents", async () => {
    const tools = (await source()("fx000001"))!.tools;
    const result = await run(tools, "search_book", { query: "NOVITA" });

    expect(result).toContain("- cap. 1 «Le ore che scivolano»:");
    expect(result).toContain("novità");
  });

  it("search_book falls back to the lines with all the words when there is no exact phrase", async () => {
    const tools = (await source()("fx000001"))!.tools;
    const result = await run(tools, "search_book", { query: "aiuole giardiniere" });

    expect(result).toContain("Nessuna frase esatta");
    expect(result).toContain("- cap. 2 «Il giardiniere distratto»:");
    expect(result).toContain("giardiniere");
  });

  it("search_book says when nothing matches and suggests synonyms or translations", async () => {
    const tools = (await source()("fx000001"))!.tools;
    const result = await run(tools, "search_book", { query: "dinosauro" });

    expect(result).toContain("Nessun risultato per «dinosauro»");
    expect(result).toContain("sinonimi");
    expect(result).toContain("lingua del libro: it");
  });

  it("loads the text lazily, once for all the tools", async () => {
    const provider = fixtureText();
    const tools = (await source(provider.getBookText)("fx000001"))!.tools;
    expect(provider.state.calls).toBe(0);

    await run(tools, "read_chapter", { chapter: 1 });
    await run(tools, "search_book", { query: "abitudine" });
    await run(tools, "read_chapter", { chapter: 3 });
    expect(provider.state.calls).toBe(1);
  });

  it("reports a text that cannot be loaded as a tool result, and tries again on the next call", async () => {
    let attempts = 0;
    const tools = (await source(async () => {
      attempts++;
      if (attempts === 1) throw new Error("EPUB assente");
      return fixtureText().getBookText();
    })("fx000001"))!.tools;

    expect(await run(tools, "read_chapter", { chapter: 1 })).toBe(
      "Testo del libro non disponibile: EPUB assente",
    );
    expect(await run(tools, "read_chapter", { chapter: 1 })).toContain("Capitolo 1");
    expect(attempts).toBe(2);
  });
});

describe("book chat over HTTP", () => {
  it("lets the model call read_chapter and then answer; the stream carries the tool call and the text", async () => {
    mock = await startMockLlm([
      { toolCalls: [{ name: "read_chapter", arguments: { chapter: 2 } }] },
      { text: "Nel capitolo 2 l'autore parla della regola dell'unica aiuola (cap. 2)." },
    ]);
    const resolve = source();
    const llm = createLlm(
      loadAiConfig({ EHUB_AI_BASE_URL: mock.baseURL, EHUB_AI_API_KEY: "test-key" }),
    );
    const app = createChatApp({
      getLlm: () => llm,
      resolveSource: (chatSource) =>
        chatSource.kind === "book" ? resolve(chatSource.id) : Promise.resolve(undefined),
    });

    const body: ChatRequestBody = {
      id: "conv-book-1",
      source: { kind: "book", id: "fx000001" },
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "Cosa dice il capitolo 2?" }] },
      ],
    };
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);

    const events = (await response.text())
      .split("\n\n")
      .map((event) => event.trim())
      .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
      .map((event) => JSON.parse(event.slice("data: ".length)));
    const call = events.find((e) => e.type === "tool-input-available");
    expect(call).toMatchObject({ toolName: "read_chapter", input: { chapter: 2 } });
    const output = events.find((e) => e.type === "tool-output-available");
    expect(String(output.output)).toContain("Capitolo 2 «Il giardiniere distratto» — parte 1 di 1");
    const text = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Nel capitolo 2 l'autore parla della regola dell'unica aiuola (cap. 2).");

    // The second model call received the tool result.
    expect(JSON.stringify(mock.requests[1].messages)).toContain(
      "Capitolo 2 «Il giardiniere distratto»",
    );
  });
});
