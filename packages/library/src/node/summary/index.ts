/**
 * Book summaries (docs/chat.md §4): one model call per chapter (map), then one for the whole book (reduce), written to
 * `data/books/<id>/summary.json`. The text comes from the local text cache (`elib text`), never from the repo.
 *
 * The model is injected (`SummarizerDeps.model`, an AI SDK `LanguageModel`), so tests use a mock model.
 */
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { type LanguageModel, generateText } from "@ehub/chat/node";
import type { SummarizeResponse } from "../../shared/api.ts";
import {
  BOOK_SUMMARY_VERSION,
  type BookSummary,
  type ChapterSummary,
} from "../../shared/schema.ts";
import { cachedSummaryProgressPath } from "../cache/index.ts";
import { readBook, writeBookSummary } from "../repo/index.ts";
import { writeFileAtomic } from "../repo/fs.ts";
import {
  type TextContext,
  type TextManifest,
  type TextManifestChapter,
  extractBookText,
} from "../text/index.ts";
import { countWords } from "../text/markdown.ts";

/** Chapters shorter than this get `summary: null` and no model call (cover, copyright, index…). */
export const SHORT_CHAPTER_WORDS = 150;
/** Chapters longer than this are split into parts (map), then merged (reduce). */
export const LONG_CHAPTER_WORDS = 25_000;
/** Target size of one part of a long chapter. */
export const PART_WORDS = 12_000;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_RETRY_DELAY_MS = 2_000;
/** Attempts of one model call that is rate limited (HTTP 429 or 503). Other errors get 2 attempts. */
export const RATE_LIMIT_ATTEMPTS = 4;
/** Wait when a rate-limited answer has no usable `retry-after` header. */
export const DEFAULT_RETRY_AFTER_SECONDS = 30;
/** Longest wait for one rate-limited answer, whatever the `retry-after` header says. */
export const MAX_RETRY_AFTER_SECONDS = 120;

/**
 * A model call failed for good (or the summary could not be produced). `step` names the chapter or the book.
 * `savedChapters` is how many chapter summaries are in the progress file: the message tells the user to run again.
 */
export class AiFailedError extends Error {
  readonly step: string;
  readonly savedChapters: number;

  constructor(step: string, options?: ErrorOptions & { savedChapters?: number }) {
    const saved = options?.savedChapters ?? 0;
    const cause = errorMessage(options?.cause).replace(/\.$/, "");
    const resume =
      saved > 0
        ? `. ${saved === 1 ? "1 capitolo salvato" : `${saved} capitoli salvati`}: rilancia per riprendere`
        : "";
    super(`Sintesi non riuscita per ${step}: ${cause}${resume}`, options);
    this.name = "AiFailedError";
    this.step = step;
    this.savedChapters = saved;
  }
}

/** The text of the book could not be extracted (no EPUB in the cache, unreadable EPUB…). */
export class TextUnavailableError extends Error {
  readonly bookId: string;

  constructor(bookId: string, options?: ErrorOptions) {
    super(`Testo del libro ${bookId} non disponibile: ${errorMessage(options?.cause)}`, options);
    this.name = "TextUnavailableError";
    this.bookId = bookId;
  }
}

export interface SummarizerDeps {
  /** Absolute `data/` dir. */
  dataDir: string;
  /** Data and cache dirs of the text extraction. */
  text: TextContext;
  /** Model for the chapter and book calls (the summary model of the configuration). */
  model: LanguageModel;
  /** Model id from the configuration: the fallback for `summary.model` when the router reports none. */
  configuredModel: string;
  /** Reasoning effort sent as `providerOptions.ehub.reasoningEffort` on every call; omitted when undefined. */
  reasoningEffort?: string;
  /** Clock for `generatedAt` and `durationMs` (tests). */
  now?: () => Date;
  /** Wait between attempts of a call (tests pass a no-op). Rejects with the signal's reason when aborted. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Default `DEFAULT_RETRY_DELAY_MS`. */
  retryDelayMs?: number;
  /** Overrides the repo root used by the text cache guard (tests). */
  repoRoot?: string;
}

/** Why a chapter got no summary: front/back matter (checked first) or fewer than `SHORT_CHAPTER_WORDS` words. */
export type SkipReason = "short" | "front-back-matter";

export type SummarizeProgress =
  | {
      kind: "chapter";
      /** Chapters finished so far (in completion order), out of `total`. */
      done: number;
      total: number;
      chapter: TextManifestChapter;
      /** "reused": the summary was saved by an earlier run and taken from the progress file (no model call). */
      status: "summarized" | "skipped" | "reused";
      /** Set when `status` is "skipped". */
      reason?: SkipReason;
    }
  /** The model is rate limited: the run sleeps `seconds` before the next attempt of `chapter` (a step label). */
  | { kind: "waiting"; seconds: number; chapter: string }
  | { kind: "book" }
  /** A summary is not in the requested language after its retry: kept anyway, the run goes on. */
  | { kind: "warning"; step: string; message: string };

export interface SummarizeOptions {
  /** Output language, BCP 47 (e.g. "it"). */
  language: string;
  /** Regenerate the book text too (`elib text --force`). */
  force?: boolean;
  /** Parallel model calls. Default `DEFAULT_CONCURRENCY`. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (event: SummarizeProgress) => void;
}

/**
 * Summarizes every chapter of a book and the book itself, then writes `summary.json`.
 * Throws `TextUnavailableError` (no text), `AiFailedError` (a call failed after one retry), `AbortError` (signal).
 */
export async function summarizeBook(
  deps: SummarizerDeps,
  id: string,
  options: SummarizeOptions,
): Promise<SummarizeResponse> {
  // A forced run starts from scratch: the chapter summaries saved by an earlier run are dropped.
  const progressFile = cachedSummaryProgressPath(deps.text.cacheDir, id);
  if (options.force === true) await rm(progressFile, { force: true });
  const book = await readBook(deps.dataDir, id);
  let extracted: Awaited<ReturnType<typeof extractBookText>>;
  try {
    extracted = await extractBookText(deps.text, id, {
      force: options.force === true,
      ...(deps.repoRoot ? { repoRoot: deps.repoRoot } : {}),
    });
  } catch (error) {
    throw new TextUnavailableError(id, { cause: error });
  }
  return summarizeText(
    deps,
    {
      id,
      title: book.title,
      authors: book.authors,
      ...(book.description !== undefined ? { description: book.description } : {}),
      outputDir: extracted.outputDir,
      manifest: extracted.manifest,
      progressFile,
      write: async (summary) => {
        await writeBookSummary(deps.dataDir, summary);
      },
    },
    options,
  );
}

/** What the summarizer reads and writes for one text: its chapter files, its metadata and where the results go. */
export interface SummarySource {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  /** Folder of the chapter files (`manifest.chapters[i].file`). */
  outputDir: string;
  manifest: TextManifest;
  /** Checkpoint of the chapter summaries: a later run resumes from it; removed once the summary is written. */
  progressFile: string;
  /** Stores the finished summary (`summary.json`). */
  write(summary: BookSummary): Promise<void>;
}

/** The model side of the summarizer deps (no data dir, no text cache): what `summarizeText` needs. */
export type SummarizeModelDeps = Pick<
  SummarizerDeps,
  "model" | "configuredModel" | "reasoningEffort" | "now" | "sleep" | "retryDelayMs"
>;

/**
 * Map/reduce summary of any text (see `SummarySource`): one model call per chapter, then one for the whole text.
 * The caller reads the text and removes a stale progress file (`force`); this function only reuses the progress file
 * when `options.force` is not set. Same errors as `summarizeBook`.
 */
export async function summarizeText(
  deps: SummarizeModelDeps,
  source: SummarySource,
  options: SummarizeOptions,
): Promise<SummarizeResponse> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const { language, signal } = options;
  const started = now().getTime();
  // Caller's signal, plus the internal stop switch: the first failure stops every model call not yet started.
  const { id, progressFile, outputDir, manifest } = source;
  // Chapter summaries saved by an earlier run, by `${n}:${hash of the chapter text}` (same language only).
  const reusable = options.force === true ? new Map<string, string>() : await readCheckpoint(progressFile, language);
  // Every chapter summary of this run so far (reused or new), written to the progress file after each chapter.
  const checkpoint: CheckpointChapter[] = [];
  // Writes run one after the other (chapters finish in parallel): the file is never written by two writes at once.
  let saving: Promise<void> = Promise.resolve();
  const saveCheckpoint = (): Promise<void> => {
    const snapshot = `${JSON.stringify({ version: 1, bookId: id, language, chapters: checkpoint }, null, 2)}\n`;
    const write = saving.then(() => writeFileAtomic(progressFile, snapshot));
    // A failed write does not block the next ones; its caller still gets the error.
    saving = write.catch(() => {});
    return write;
  };

  const controller = new AbortController();
  const runSignal = controller.signal;
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const limit = createLimiter(concurrency);
  const failures: unknown[] = [];
  const fail = (error: unknown): void => {
    if (failures.length > 0) return;
    failures.push(error);
    controller.abort(error);
  };

  // Model that answered last (router header of the last successful call that reported one); else the configured id.
  let routerModel: string | undefined;

  /**
   * One model call with one retry (on an error, or on an answer in the wrong language). Records the router model of
   * every successful call. A wrong-language answer that is still wrong after the retry is kept, with a warning.
   */
  async function callModel(step: string, system: string, prompt: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      runSignal.throwIfAborted();
      let text: string;
      try {
        const result = await generateText({
          model: deps.model,
          system,
          prompt: `${prompt}\n\n${languageInstruction(language)}`,
          maxRetries: 0, // one retry here, not the SDK's
          abortSignal: runSignal,
          ...(deps.reasoningEffort !== undefined
            ? { providerOptions: { ehub: { reasoningEffort: deps.reasoningEffort } } }
            : {}),
        });
        text = result.text.trim();
        if (text === "") throw new Error("risposta vuota del modello");
        const reported = headerValue(result.response?.headers, "x-router-model");
        if (reported) routerModel = reported;
      } catch (error) {
        if (runSignal.aborted) throw error;
        const waitSeconds = rateLimitWaitSeconds(error);
        if (waitSeconds !== undefined) {
          if (attempt >= RATE_LIMIT_ATTEMPTS) throw new AiFailedError(step, { cause: error });
          options.onProgress?.({ kind: "waiting", seconds: waitSeconds, chapter: step });
          await sleep(waitSeconds * 1000, runSignal);
          continue;
        }
        if (attempt >= 2) throw new AiFailedError(step, { cause: error });
        await sleep(retryDelayMs, runSignal);
        continue;
      }
      if (looksLikeLanguage(text, language)) return text;
      if (attempt >= 2) {
        options.onProgress?.({
          kind: "warning",
          step,
          message: `la sintesi non sembra in ${langName} (codice ${language}) anche dopo un nuovo tentativo: salvata comunque`,
        });
        return text;
      }
    }
  }

  const langName = languageName(language);
  const chapters: ChapterSummary[] = new Array(manifest.chapters.length);
  let done = 0;

  /** Every model call (chapter, part, merge, book) takes a limiter slot: at most `concurrency` run at once. */
  // A failed call stops the run before its slot is released, so the next queued call never starts.
  const modelCall = (step: string, system: string, prompt: string): Promise<string> =>
    limit(() =>
      callModel(step, system, prompt).catch((error: unknown) => {
        fail(error);
        throw error;
      }),
    );

  async function summarizeChapter(text: string, chapter: TextManifestChapter): Promise<string> {
    const step = `capitolo ${chapter.n} "${chapter.title}"`;
    const context = { title: source.title, authors: source.authors.join(", "), chapter };
    const words = countWords(text);
    if (words <= LONG_CHAPTER_WORDS) {
      return modelCall(step, chapterSystem(langName, language), chapterPrompt(context, text));
    }
    const parts = splitIntoParts(text, PART_WORDS);
    // The parts run in parallel; `Promise.all` keeps their order for the merge. No slot is held while waiting here.
    const partSummaries = await Promise.all(
      parts.map((part, i) =>
        modelCall(
          `${step}, parte ${i + 1}/${parts.length}`,
          chapterSystem(langName, language),
          partPrompt(context, part, i + 1, parts.length),
        ),
      ),
    );
    return modelCall(
      `${step} (unione delle parti)`,
      chapterSystem(langName, language),
      mergePrompt(context, partSummaries),
    );
  }

  let bookText: string;
  try {
    // The texts are read first, so every chapter queues its model call in chapter order (the limiter is FIFO).
    const texts = await Promise.all(
      manifest.chapters.map((chapter) =>
        isFrontOrBackMatter(chapter.title) || chapter.words < SHORT_CHAPTER_WORDS
          ? Promise.resolve(undefined)
          : readFile(path.join(outputDir, chapter.file), "utf8"),
      ),
    );
    // Every chapter starts at once; the limiter lets only `concurrency` model calls run. A failure stops the rest.
    await Promise.all(
      manifest.chapters.map(async (chapter, i) => {
        try {
          runSignal.throwIfAborted();
          let summary: string | null = null;
          let status: "summarized" | "skipped" | "reused" = "skipped";
          let reason: SkipReason | undefined;
          if (isFrontOrBackMatter(chapter.title)) reason = "front-back-matter";
          else if (chapter.words < SHORT_CHAPTER_WORDS) reason = "short";
          if (reason === undefined) {
            const text = texts[i]!;
            const hash = sha256(text);
            const saved = reusable.get(`${chapter.n}:${hash}`);
            if (saved !== undefined) {
              summary = saved;
              status = "reused";
            } else {
              summary = await summarizeChapter(text, chapter);
              status = "summarized";
            }
            checkpoint.push({ n: chapter.n, hash, summary });
            await saveCheckpoint();
          }
          chapters[i] = { n: chapter.n, title: chapter.title, words: chapter.words, summary };
          done += 1;
          options.onProgress?.({
            kind: "chapter",
            done,
            total: manifest.chapters.length,
            chapter,
            status,
            ...(reason !== undefined ? { reason } : {}),
          });
        } catch (error) {
          fail(error);
        }
      }),
    );
    if (failures.length > 0) throw failures[0];

    bookText = await modelCall(
      "sintesi del libro",
      bookSystem(langName, language),
      bookPrompt(
        { title: source.title, authors: source.authors.join(", "), description: source.description },
        chapters,
      ),
    );
  } catch (error) {
    // Pending checkpoint writes finish first: the chapters saved so far are on disk, the next run resumes from them.
    await saving;
    if (error instanceof AiFailedError) {
      throw new AiFailedError(error.step, { cause: error.cause, savedChapters: checkpoint.length });
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onCallerAbort);
  }
  options.onProgress?.({ kind: "book" });

  const summary: BookSummary = {
    version: BOOK_SUMMARY_VERSION,
    bookId: id,
    generatedAt: now().toISOString(),
    model: routerModel ?? deps.configuredModel,
    language,
    book: bookText,
    chapters,
  };
  await source.write(summary);
  // summary.json is written: the progress file has nothing left to resume.
  await rm(progressFile, { force: true });
  return {
    summary,
    summarizedChapters: chapters.filter((c) => c.summary !== null).length,
    durationMs: Math.max(0, now().getTime() - started),
  };
}

const FRONT_BACK_MATTER_TITLES = [
  "cover", "copertina", "title page", "frontespizio", "copyright", "dedication", "dedica", "epigraph", "epigrafe",
  "contents", "table of contents", "indice", "sommario", "index", "indice analitico", "indice dei nomi", "notes",
  "endnotes", "note", "bibliography", "bibliografia", "references", "riferimenti bibliografici", "acknowledgments",
  "acknowledgements", "ringraziamenti", "about the author", "a note about the author", "l'autore",
  "nota sull'autore", "also by", "other titles", "other books by", "dello stesso autore", "praise for", "credits",
  "crediti", "colophon",
];

/** Titles that START with one of these are front/back matter (e.g. "About the Author: ..."). */
const FRONT_BACK_MATTER_PREFIXES = [
  "about the author",
  "also by",
  "praise for",
  "other books by",
  "a note on the text",
];

/** Lowercases, drops accents, unifies apostrophes and collapses spaces. */
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const FRONT_BACK_MATTER_SET = new Set(FRONT_BACK_MATTER_TITLES.map(normalizeTitle));
const FRONT_BACK_MATTER_PREFIX_LIST = FRONT_BACK_MATTER_PREFIXES.map(normalizeTitle);

/**
 * True when a chapter title is book front or back matter (cover, copyright, notes, index, acknowledgments…), in
 * English or Italian. Case- and accent-insensitive; the WHOLE title must match after a leading number or punctuation
 * ("12. Notes") and surrounding punctuation are dropped, so real chapter titles that merely contain a word
 * ("Notes on Camp", "The Index of Desire") do not match. A few phrases also match as a prefix.
 */
export function isFrontOrBackMatter(title: string): boolean {
  const normalized = normalizeTitle(title)
    .replace(/^[\s\d\p{P}]+/u, "")
    .replace(/[\s\p{P}]+$/u, "");
  if (normalized === "") return false;
  if (FRONT_BACK_MATTER_SET.has(normalized)) return true;
  return FRONT_BACK_MATTER_PREFIX_LIST.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Splits a text into parts of about `maxWords` words, at paragraph boundaries (a paragraph is never cut, so a part
 * can be longer when one paragraph is).
 */
export function splitIntoParts(text: string, maxWords: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const parts: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);
    if (current.length > 0 && currentWords + words > maxWords) {
      parts.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    current.push(paragraph);
    currentWords += words;
  }
  if (current.length > 0) parts.push(current.join("\n\n"));
  return parts;
}

/**
 * Counting semaphore: `limit(fn)` waits for a free slot, runs `fn` and frees the slot when it settles (also on error).
 * A freed slot goes straight to the next waiter, so no more than `concurrency` calls run at once.
 */
function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Prompts (instructions in Italian; the output language is the `language` option)
// ---------------------------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<string, string> = {
  it: "italiano",
  en: "inglese",
  fr: "francese",
  de: "tedesco",
  es: "spagnolo",
  pt: "portoghese",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase().split("-")[0]!] ?? code;
}

/** Last line of every user prompt: the output language, stated again right before the model answers. */
export function languageInstruction(code: string): string {
  const base = code.toLowerCase().split("-")[0]!;
  const name = LANGUAGE_NAMES[base];
  return name
    ? `Scrivi il riassunto esclusivamente in ${name}.`
    : `Write the summary only in the language with code ${code}.`;
}

const STOPWORDS: Record<"it" | "en", readonly string[]> = {
  it: ["il", "la", "che", "di", "e", "per", "non", "una", "del", "della", "sono", "come", "con"],
  en: ["the", "and", "of", "to", "is", "that", "in", "it", "for", "with", "as", "are"],
};

/**
 * Cheap check that `text` is in language `code`: counts the frequent stopwords of `code` and of the other language
 * (it or en). Matches when the target's count is at least the other's and at least 3. Other languages always match.
 */
export function looksLikeLanguage(text: string, code: string): boolean {
  const base = code.toLowerCase().split("-")[0]!;
  if (base !== "it" && base !== "en") return true;
  const other = base === "it" ? "en" : "it";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const count = (list: readonly string[]) => words.reduce((n, w) => (list.includes(w) ? n + 1 : n), 0);
  const target = count(STOPWORDS[base]);
  return target >= count(STOPWORDS[other]) && target >= 3;
}

function chapterSystem(langName: string, code: string): string {
  return [
    `Scrivi in ${langName} (codice ${code}).`,
    "Un paragrafo con parole tue, senza citazioni, premesse, titoli, elenchi o Markdown.",
  ].join("\n");
}

function bookSystem(langName: string, code: string): string {
  return [
    `Scrivi in ${langName} (codice ${code}).`,
    "Uno o due paragrafi con parole tue, senza citazioni, premesse, titoli o elenchi.",
  ].join("\n");
}

interface BookContext {
  title: string;
  authors: string;
  chapter?: TextManifestChapter;
}

function bookLine(context: BookContext): string {
  return `Libro: "${context.title}"${context.authors ? ` di ${context.authors}` : ""}.`;
}

function chapterPrompt(context: BookContext & { chapter: TextManifestChapter }, text: string): string {
  return [
    bookLine(context),
    `Capitolo ${context.chapter.n}: "${context.chapter.title}".`,
    "",
    "Scrivi una sintesi di 80-150 parole: l'argomento del capitolo e le idee principali.",
    "",
    "Testo del capitolo:",
    "",
    text,
  ].join("\n");
}

function partPrompt(
  context: BookContext & { chapter: TextManifestChapter },
  part: string,
  index: number,
  count: number,
): string {
  return [
    bookLine(context),
    `Questa è la parte ${index} di ${count} del capitolo ${context.chapter.n}: "${context.chapter.title}".`,
    "",
    "Scrivi una sintesi di 60-100 parole delle idee di questa parte.",
    "",
    "Testo della parte:",
    "",
    part,
  ].join("\n");
}

function mergePrompt(context: BookContext & { chapter: TextManifestChapter }, parts: string[]): string {
  return [
    bookLine(context),
    `Di seguito le sintesi delle ${parts.length} parti, in ordine, del capitolo ${context.chapter.n}: "${context.chapter.title}".`,
    "Scrivi una sintesi unica del capitolo intero di 80-150 parole, senza ripetere le parti.",
    "",
    ...parts.map((p, i) => `Parte ${i + 1}: ${p}`),
  ].join("\n");
}

function bookPrompt(
  book: { title: string; authors: string; description?: string | undefined },
  chapters: ChapterSummary[],
): string {
  const summarized = chapters.filter((c) => c.summary !== null);
  const chapterList =
    summarized.length > 0
      ? summarized.map((c) => `Capitolo ${c.n} - ${c.title}: ${c.summary}`).join("\n\n")
      : "(nessuna sintesi di capitolo disponibile)";
  return [
    bookLine({ title: book.title, authors: book.authors }),
    `Descrizione: ${book.description ?? "non disponibile"}`,
    "",
    "Capitoli sintetizzati, in ordine:",
    chapterList,
    "",
    "In 150-250 parole, riassumi tesi, struttura e idee chiave. Usa solo dettagli presenti qui.",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Waits `ms`; rejects with the signal's reason as soon as the signal aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Seconds to wait before retrying a rate-limited call (HTTP 429 or 503, as the local router answers when every
 * provider is busy), from the `retry-after` header (seconds). `undefined` for any other error.
 */
export function rateLimitWaitSeconds(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { statusCode, responseHeaders } = error as { statusCode?: unknown; responseHeaders?: unknown };
  if (statusCode !== 429 && statusCode !== 503) return undefined;
  const raw = headerValue(
    responseHeaders !== null && typeof responseHeaders === "object"
      ? (responseHeaders as Record<string, string>)
      : undefined,
    "retry-after",
  );
  const seconds = raw !== undefined && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

/** One chapter summary in the progress file: `hash` is the SHA-256 of the chapter text (the key with `n`). */
interface CheckpointChapter {
  n: number;
  hash: string;
  summary: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Chapter summaries of an earlier run in `file`, keyed `${n}:${hash}`, for the given language. A missing or unreadable
 * file gives an empty map (the run then summarizes everything).
 */
async function readCheckpoint(file: string, language: string): Promise<Map<string, string>> {
  const saved = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return saved;
  }
  const { language: savedLanguage, chapters } = (parsed ?? {}) as { language?: unknown; chapters?: unknown };
  if (savedLanguage !== language || !Array.isArray(chapters)) return saved;
  for (const entry of chapters as Partial<CheckpointChapter>[]) {
    if (
      typeof entry?.n === "number" &&
      typeof entry.hash === "string" &&
      typeof entry.summary === "string" &&
      entry.summary.trim() !== ""
    ) {
      saved.set(`${entry.n}:${entry.hash}`, entry.summary);
    }
  }
  return saved;
}
