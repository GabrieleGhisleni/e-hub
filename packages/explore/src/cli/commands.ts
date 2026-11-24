/**
 * Every `explore` subcommand. Each action calls the repo (never the JSON files) and prints either the ID plus a
 * line of outcome, or with `--json` the whole exploration. Errors are thrown and mapped in program.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import {
  ExploreError,
  addExploreBook,
  addJournal,
  addLibraryBook,
  addNote,
  appendNotebook,
  checkExplorations,
  createExploration,
  exploreDataDir,
  listExplorations,
  addBooksToLibraryAndKobo,
  planKoboBooks,
  prepareExploration,
  removeBooksFromKobo,
  withLibraryDeps,
  readExploration,
  removeBook,
  setNotebook,
  setVerdict,
  updateExploration,
} from "../node/index.ts";
import {
  type Exploration,
  type Via,
  type VerdictDecision,
  Via as ViaSchema,
  VerdictDecision as VerdictDecisionSchema,
  formatVerdict,
} from "../schema.ts";
import { formatDate, formatExploration, formatPrepared, formatTable } from "./format.ts";
import { type CliContext, ExitWith, UsageError } from "./program.ts";

const collect = (value: string, previous: string[] = []) => [...previous, value];

/** Exactly one of the options (keys as commander names them, values as the flags to show) must be set. */
function exactlyOne(options: Record<string, unknown>, flags: Record<string, string>): void {
  const given = Object.keys(flags).filter((key) => options[key] !== undefined && options[key] !== false);
  if (given.length !== 1) {
    throw new UsageError(`indica esattamente una tra ${Object.values(flags).join(", ")}`);
  }
}

function parseChapters(raw: string): number[] {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part) || Number(part) < 1)) {
    throw new UsageError(`Capitoli non validi: «${raw}» (usa numeri separati da virgole, es. 2,5)`);
  }
  return parts.map(Number);
}

const VIA_OPTION = ["--via <origine>", "chi scrive: cli, skill o app", "cli"] as const;

function parseVia(raw: string): Via {
  const parsed = ViaSchema.safeParse(raw);
  if (!parsed.success) throw new UsageError(`Origine non valida: «${raw}» (cli, skill o app)`);
  return parsed.data;
}

function parseBudget(raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new UsageError(`Budget non valido: «${raw}» (un numero di token maggiore di zero)`);
  }
  return Number(raw);
}

/** Prints the result of a change: the ID, then one line of outcome (or the whole exploration with `--json`). */
function reportChange(ctx: CliContext, exploration: Exploration, outcome: string, json?: boolean) {
  if (json) {
    ctx.out(JSON.stringify(exploration, null, 2));
    return;
  }
  ctx.out(exploration.id);
  ctx.out(outcome);
}

/** Text from exactly one of `--text` or `--text-file` (`-` reads stdin). */
async function textOption(
  ctx: CliContext,
  options: { text?: string; textFile?: string },
): Promise<string> {
  exactlyOne(options, { text: "--text", textFile: "--text-file" });
  if (options.text !== undefined) return options.text;
  return ctx.readText(options.textFile!);
}

/** Reads an EPUB given on the command line; the file name is kept for the record. */
async function readEpub(ctx: CliContext, file: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const full = ctx.resolve(file);
  try {
    const bytes = await readFile(full);
    return { bytes: new Uint8Array(bytes), fileName: path.basename(full) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ExploreError("invalid-input", `File non trovato: ${full}`);
    }
    throw error;
  }
}

export function registerCommands(program: Command, ctx: CliContext): void {
  const deps = ctx.deps;

  program
    .command("list")
    .description("elenca le esplorazioni, la più recente per prima")
    .option("--tag <tag>", "solo le esplorazioni con questo tag (ripetibile)", collect, [])
    .option("--json", "stampa JSON")
    .action(async (options: { tag: string[]; json?: boolean }) => {
      const wanted = options.tag.map((t) => t.trim().toLowerCase());
      const all = (await listExplorations()).filter(
        (e) => wanted.length === 0 || (e.tags ?? []).some((tag) => wanted.includes(tag)),
      );
      if (options.json) {
        ctx.out(JSON.stringify(all, null, 2));
        return;
      }
      if (all.length === 0) {
        ctx.out("Nessuna esplorazione.");
        return;
      }
      const rows = all.map((e) => [
        e.id,
        e.status === "open" ? "aperta" : "chiusa",
        String(e.sources.length),
        formatDate(e.updatedAt),
        (e.tags ?? []).join(", "),
        e.title,
      ]);
      for (const line of formatTable(["ID", "Stato", "Fonti", "Aggiornata", "Tag", "Titolo"], rows)) {
        ctx.out(line);
      }
    });

  program
    .command("tag <id>")
    .description("mostra o cambia i tag di un'esplorazione (es. filosofia)")
    .option("--add <tag>", "aggiunge un tag (ripetibile)", collect, [])
    .option("--remove <tag>", "toglie un tag (ripetibile)", collect, [])
    .option("--set <tag>", "sostituisce tutti i tag (ripetibile; --set '' li toglie)", collect)
    .option("--json", "stampa JSON")
    .action(
      async (
        id: string,
        options: { add: string[]; remove: string[]; set?: string[]; json?: boolean },
      ) => {
        const current = await readExploration(id);
        const changing = options.add.length > 0 || options.remove.length > 0 || options.set !== undefined;
        if (!changing) {
          if (options.json) ctx.out(JSON.stringify(current.tags ?? [], null, 2));
          else ctx.out((current.tags ?? []).join(", ") || "Nessun tag.");
          return;
        }
        if (options.set !== undefined && (options.add.length > 0 || options.remove.length > 0)) {
          throw new UsageError("--set non si combina con --add o --remove");
        }
        const norm = (t: string) => t.trim().toLowerCase();
        const base =
          options.set !== undefined
            ? options.set.map(norm).filter((t) => t !== "")
            : (current.tags ?? []).filter((t) => !options.remove.map(norm).includes(t));
        const exploration = await updateExploration(id, {
          tags: options.set !== undefined ? base : [...base, ...options.add],
        });
        reportChange(ctx, exploration, `Tag: ${(exploration.tags ?? []).join(", ") || "nessuno"}.`, options.json);
      },
    );

  program
    .command("kobo")
    .description(
      "aggiunge alla libreria (stesso ID) i libri esplorati delle esplorazioni scelte per ID o tag, con un argomento, e li manda sul Kobo; con --remove li toglie dal Kobo",
    )
    .option("--id <id>", "esplorazione (ripetibile)", collect, [])
    .option("--tag <tag>", "tutte le esplorazioni con questo tag (ripetibile)", collect, [])
    .option(
      "--verdict <decisione>",
      "solo libri con questo verdetto: all, parts, undecided, skip (ripetibile; default: tutti tranne skip)",
      collect,
      [],
    )
    .option("--topic <argomento>", "argomento della libreria (ID o nome, es. filosofia): diventa la serie sul Kobo")
    .option("--dry-run", "mostra cosa farebbe, senza scrivere")
    .option("--remove", "invece di aggiungere, toglie dal Kobo i libri non ancora in libreria (irreversibile: il Kobo non ha cestino)")
    .option("--json", "stampa JSON")
    .action(
      async (options: {
        id: string[];
        tag: string[];
        verdict: string[];
        topic?: string;
        dryRun?: boolean;
        remove?: boolean;
        json?: boolean;
      }) => {
        const decisions = options.verdict.map((raw) => {
          const parsed = VerdictDecisionSchema.safeParse(raw);
          if (!parsed.success) throw new UsageError(`Verdetto non valido: «${raw}» (all, parts, undecided, skip)`);
          return parsed.data;
        });
        const library = withLibraryDeps(deps);
        const plan = planKoboBooks(await listExplorations(), {
          ids: options.id,
          tags: options.tag,
          ...(decisions.length > 0 ? { decisions } : {}),
        });
        const dryRun = options.dryRun === true;

        let topicId: string | undefined;
        if (!options.remove && plan.books.length > 0) {
          if (!options.topic) throw new UsageError("indica l'argomento della libreria con --topic (es. --topic filosofia)");
          const topics = await library.listLibraryTopics();
          const wanted = options.topic.trim().toLowerCase();
          const found = topics.find((t) => t.id === wanted || t.label.toLowerCase() === wanted);
          if (!found) {
            throw new UsageError(
              `Argomento «${options.topic}» non trovato (disponibili: ${topics.map((t) => t.id).join(", ")})`,
            );
          }
          topicId = found.id;
        }

        if (!options.json) {
          ctx.err(`Esplorazioni: ${plan.explorations.join(", ") || "nessuna"}`);
          ctx.err(
            `Libri: ${plan.books.length} (già in libreria: ${plan.skippedLibrary}, esclusi dal verdetto: ${plan.skippedVerdict})`,
          );
          for (const book of plan.books) ctx.err(`  ${book.id}  ${book.title}`);
          if (topicId) ctx.err(`Argomento in libreria (serie sul Kobo): ${topicId}`);
        }
        if (plan.books.length === 0) {
          if (options.json) ctx.out(JSON.stringify({ plan, reports: [], failures: [] }, null, 2));
          else ctx.out("Nessun libro da aggiungere.");
          return;
        }
        if (dryRun && !options.remove) {
          if (options.json) ctx.out(JSON.stringify({ plan, reports: [], failures: [] }, null, 2));
          else ctx.out("Dry run: nessuna scrittura. Senza --dry-run i libri entrano in libreria e vanno sul Kobo.");
          return;
        }

        let reports;
        let failures: { id: string; message: string }[] = [];
        if (options.remove) {
          reports = await removeBooksFromKobo(plan, { dryRun }, deps);
        } else {
          ({ reports, failures } = await addBooksToLibraryAndKobo(plan, topicId!, deps));
        }
        if (options.json) {
          ctx.out(JSON.stringify({ plan, reports, failures }, null, 2));
        } else {
          for (const report of reports) for (const line of library.formatKoboReport(report)) ctx.out(line);
          for (const failure of failures) ctx.err(`errore: ${failure.id}: ${failure.message}`);
        }
        if (failures.length > 0 || reports.some((r) => r.errors.length > 0)) throw new ExitWith(1);
      },
    );

  program
    .command("show <id>")
    .description("mostra un'esplorazione: domanda, fonti con verdetto, sintesi, quaderno, note e diario")
    .option("--json", "stampa JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const exploration = await readExploration(id);
      if (options.json) {
        ctx.out(JSON.stringify(exploration, null, 2));
        return;
      }
      for (const line of formatExploration(exploration)) ctx.out(line);
    });

  program
    .command("new")
    .description("crea un'esplorazione (stampa il suo ID)")
    .requiredOption("--title <titolo>", "titolo")
    .requiredOption("--question <domanda>", "la domanda da porre ai libri")
    .option("--book <id>", "libro della libreria come fonte (ripetibile)", collect, [])
    .option("--epub <file>", "EPUB da esplorare solo qui (ripetibile)", collect, [])
    .option("--json", "stampa JSON")
    .action(
      async (options: {
        title: string;
        question: string;
        book: string[];
        epub: string[];
        json?: boolean;
      }) => {
        const uploads = await Promise.all(options.epub.map((file) => readEpub(ctx, file)));
        const created = await createExploration(
          { title: options.title, question: options.question, books: options.book },
          new Date(),
          deps,
        );
        let exploration = created;
        for (const upload of uploads) {
          try {
            exploration = await addExploreBook(created.id, upload, deps);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new ExploreError(
              "invalid-input",
              `Esplorazione ${created.id} creata, ma «${upload.fileName}» non è stato aggiunto: ${reason}`,
            );
          }
        }
        reportChange(
          ctx,
          exploration,
          `Esplorazione creata: «${exploration.title}» con ${exploration.sources.length} fonte/i.`,
          options.json,
        );
      },
    );

  program
    .command("add <id>")
    .description("aggiunge una fonte: un libro della libreria (--book) o un EPUB da esplorare (--epub)")
    .option("--book <id>", "ID del libro della libreria")
    .option("--epub <file>", "file EPUB da esplorare solo qui")
    .option("--json", "stampa JSON")
    .action(async (id: string, options: { book?: string; epub?: string; json?: boolean }) => {
      exactlyOne(options, { book: "--book", epub: "--epub" });
      const exploration =
        options.book !== undefined
          ? await addLibraryBook(id, options.book, deps)
          : await addExploreBook(id, await readEpub(ctx, options.epub!), deps);
      const added = exploration.sources.at(-1);
      reportChange(ctx, exploration, `Fonte aggiunta: «${added?.title ?? "?"}».`, options.json);
    });

  program
    .command("remove <id>")
    .description("rimuove una fonte (e il suo verdetto); le note restano, senza riferimento al libro")
    .requiredOption("--book <id>", "ID del libro da rimuovere")
    .option("--json", "stampa JSON")
    .action(async (id: string, options: { book: string; json?: boolean }) => {
      const exploration = await removeBook(id, options.book);
      reportChange(ctx, exploration, `Fonte ${options.book} rimossa.`, options.json);
    });

  program
    .command("prepare <id>")
    .description("prepara il testo di ogni fonte e stima i token (intero o per capitoli)")
    .option("--budget <token>", "budget di token per leggere i libri interi", String(500_000))
    .option("--json", "stampa JSON")
    .action(async (id: string, options: { budget: string; json?: boolean }) => {
      const prepared = await prepareExploration(
        id,
        { budget: parseBudget(options.budget) },
        deps,
      );
      if (options.json) {
        ctx.out(JSON.stringify(prepared, null, 2));
        return;
      }
      for (const line of formatPrepared(prepared)) ctx.out(line);
    });

  program
    .command("verdict <id>")
    .description("imposta il verdetto per una fonte")
    .requiredOption("--book <id>", "ID del libro")
    .requiredOption(
      "--decision <verdetto>",
      `verdetto: ${VerdictDecisionSchema.options.join(", ")}`,
    )
    .option("--chapters <lista>", "capitoli da leggere, separati da virgole (solo con parts)")
    .requiredOption("--reason <motivazione>", "motivazione in una riga")
    .option(...VIA_OPTION)
    .option("--json", "stampa JSON")
    .action(
      async (
        id: string,
        options: {
          book: string;
          decision: string;
          chapters?: string;
          reason: string;
          via: string;
          json?: boolean;
        },
      ) => {
        if (!VerdictDecisionSchema.safeParse(options.decision).success) {
          throw new UsageError(
            `Verdetto non valido: «${options.decision}» (scegli tra ${VerdictDecisionSchema.options.join(", ")})`,
          );
        }
        const exploration = await setVerdict(id, options.book, {
          decision: options.decision as VerdictDecision,
          ...(options.chapters !== undefined ? { chapters: parseChapters(options.chapters) } : {}),
          reason: options.reason,
        }, parseVia(options.via));
        const source = exploration.sources.find((s) => s.id === options.book);
        reportChange(
          ctx,
          exploration,
          `Verdetto salvato per ${options.book}: ${formatVerdict(source?.verdict)}.`,
          options.json,
        );
      },
    );

  program
    .command("note <id>")
    .description("aggiunge una nota all'esplorazione (facoltativamente su una fonte)")
    .option("--text <testo>", "testo della nota")
    .option("--text-file <file>", "testo da file (- per stdin)")
    .option("--book <id>", "ID del libro a cui si riferisce la nota")
    .option(...VIA_OPTION)
    .option("--json", "stampa JSON")
    .action(
      async (
        id: string,
        options: { text?: string; textFile?: string; book?: string; via: string; json?: boolean },
      ) => {
        const body = await textOption(ctx, options);
        const via = parseVia(options.via);
        const exploration = await addNote(id, { body, ...(options.book ? { book: options.book } : {}) }, via);
        reportChange(ctx, exploration, "Nota aggiunta.", options.json);
      },
    );

  program
    .command("journal <id>")
    .description("aggiunge una voce al diario (cosa è emerso, cosa resta da vedere)")
    .option("--text <testo>", "testo della voce")
    .option("--text-file <file>", "testo da file (- per stdin)")
    .option(...VIA_OPTION)
    .option("--json", "stampa JSON")
    .action(
      async (id: string, options: { text?: string; textFile?: string; via: string; json?: boolean }) => {
        const text = await textOption(ctx, options);
        const exploration = await addJournal(id, text, parseVia(options.via));
        reportChange(ctx, exploration, "Voce aggiunta al diario.", options.json);
      },
    );

  program
    .command("summary <id>")
    .description("imposta o rimuove la sintesi dell'esplorazione")
    .option("--text <testo>", "testo della sintesi")
    .option("--text-file <file>", "testo da file (- per stdin)")
    .option("--clear", "rimuove la sintesi")
    .option("--json", "stampa JSON")
    .action(
      async (
        id: string,
        options: { text?: string; textFile?: string; clear?: boolean; json?: boolean },
      ) => {
        exactlyOne(options, { text: "--text", textFile: "--text-file", clear: "--clear" });
        if (options.clear) {
          const exploration = await updateExploration(id, { summary: null });
          reportChange(ctx, exploration, "Sintesi rimossa.", options.json);
          return;
        }
        const summary = await textOption(ctx, options);
        const exploration = await updateExploration(id, { summary });
        reportChange(ctx, exploration, "Sintesi salvata.", options.json);
      },
    );

  program
    .command("notebook <id>")
    .description("imposta, aggiunge al o svuota il quaderno dell'esplorazione (Markdown condiviso)")
    .option("--text <testo>", "testo del quaderno")
    .option("--text-file <file>", "testo da file (- per stdin)")
    .option("--append", "aggiunge il testo in fondo, dopo una riga vuota (invece di sostituire)")
    .option("--clear", "svuota il quaderno")
    .option(...VIA_OPTION)
    .option("--json", "stampa JSON")
    .action(
      async (
        id: string,
        options: {
          text?: string;
          textFile?: string;
          append?: boolean;
          clear?: boolean;
          via: string;
          json?: boolean;
        },
      ) => {
        exactlyOne(options, { text: "--text", textFile: "--text-file", clear: "--clear" });
        if (options.clear && options.append) {
          throw new UsageError("--clear non si usa con --append");
        }
        const via = parseVia(options.via);
        if (options.clear) {
          const exploration = await setNotebook(id, "", via);
          reportChange(ctx, exploration, "Quaderno svuotato.", options.json);
          return;
        }
        const text = await textOption(ctx, options);
        if (options.append) {
          const exploration = await appendNotebook(id, text, via);
          reportChange(ctx, exploration, "Testo aggiunto al quaderno.", options.json);
          return;
        }
        const exploration = await setNotebook(id, text, via);
        reportChange(ctx, exploration, "Quaderno salvato.", options.json);
      },
    );

  for (const [name, status, outcome] of [
    ["close", "closed", "Esplorazione chiusa."],
    ["reopen", "open", "Esplorazione riaperta."],
  ] as const) {
    program
      .command(`${name} <id>`)
      .description(status === "closed" ? "chiude l'esplorazione" : "riapre l'esplorazione")
      .option("--json", "stampa JSON")
      .action(async (id: string, options: { json?: boolean }) => {
        const exploration = await updateExploration(id, { status });
        reportChange(ctx, exploration, outcome, options.json);
      });
  }

  program
    .command("library")
    .description("elenca i libri della libreria (id e titolo), per `new --book` e `add --book`")
    .option("--json", "stampa JSON")
    .action(async (options: { json?: boolean }) => {
      const books = await withLibraryDeps(deps).listLibraryBookRefs();
      if (options.json) {
        ctx.out(JSON.stringify(books, null, 2));
        return;
      }
      if (books.length === 0) {
        ctx.out("Nessun libro in libreria.");
        return;
      }
      const rows = books.map((b) => [b.id, b.authors.join(", "), b.title]);
      for (const line of formatTable(["ID", "Autori", "Titolo"], rows)) ctx.out(line);
    });

  program
    .command("validate")
    .description("valida tutti i file delle esplorazioni (exit 1 se ce ne sono di non validi)")
    .action(async () => {
      const { valid, problems } = await checkExplorations();
      for (const problem of problems) {
        ctx.err(`errore: ${path.basename(problem.file)}: ${problem.message}`);
        for (const detail of problem.details) ctx.err(`  - ${detail}`);
      }
      const dir = exploreDataDir();
      if (problems.length > 0) {
        ctx.out(`${valid} esplorazione/i valide, ${problems.length} file non valido/i in ${dir}.`);
        throw new ExitWith(1);
      }
      ctx.out(`${valid} esplorazione/i valide in ${dir}.`);
    });
}

