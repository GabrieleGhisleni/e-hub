import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR_ENV } from "../src/node/index.ts";
import { explorationIdFor } from "../src/schema.ts";
import { runCli } from "../src/cli/program.ts";
import { FAKE_EPUB, captureIo, fakeLibrary } from "./fakes.ts";

let dir: string;
let work: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ehub-explore-cli-"));
  work = await mkdtemp(path.join(tmpdir(), "ehub-explore-work-"));
  process.env[DATA_DIR_ENV] = dir;
});
afterEach(async () => {
  delete process.env[DATA_DIR_ENV];
  await rm(dir, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

/** Runs the CLI in-process; `cwd` is the user's working directory (relative paths resolve there). */
async function cli(argv: string[], options: { stdin?: string; cwd?: string } = {}) {
  const captured = captureIo(options.cwd ?? work, options.stdin ?? "");
  const code = await runCli(argv, captured.io, fakeLibrary());
  return { code, out: captured.stdout(), err: captured.stderr() };
}

/** Today's exploration ID for the title "Prova" (the CLI stamps the date of the run). */
const ID = explorationIdFor("Prova", new Date());

describe("explore CLI", () => {
  it("runs the whole loop: new, show, verdict, note, journal, summary, close, validate", async () => {
    const created = await cli(["new", "--title", "Prova", "--question", "Domanda?", "--book", "78w462eb"]);
    expect(created.code).toBe(0);
    expect(created.out.split("\n")[0]).toBe(ID);
    expect(created.out).toContain("Esplorazione creata");

    const shown = await cli(["show", ID]);
    expect(shown.code).toBe(0);
    expect(shown.out).toContain("Domanda: Domanda?");
    expect(shown.out).toContain("The Let Them Theory");
    expect(shown.out).toContain("Da decidere");

    const verdict = await cli([
      "verdict", ID, "--book", "78w462eb", "--decision", "parts", "--chapters", "5,2",
      "--reason", "Il capitolo sul metodo.", "--via", "skill",
    ]);
    expect(verdict.code).toBe(0);
    expect(verdict.out).toContain("Leggere i capitoli 2 e 5");

    expect((await cli(["note", ID, "--text", "Appunto", "--book", "78w462eb"])).code).toBe(0);
    expect((await cli(["journal", ID, "--text", "Emerso il tema."])).code).toBe(0);
    expect((await cli(["summary", ID, "--text", "Sintesi."])).code).toBe(0);
    expect((await cli(["close", ID])).out).toContain("Esplorazione chiusa.");

    const shownAgain = await cli(["show", ID]);
    expect(shownAgain.out).toContain("Leggere i capitoli 2 e 5");
    expect(shownAgain.out).toContain("Appunto");
    expect(shownAgain.out).toContain("Emerso il tema.");
    expect(shownAgain.out).toContain("Sintesi.");

    const validated = await cli(["validate"]);
    expect(validated.code).toBe(0);
    expect(validated.out).toContain("1 esplorazione/i valide");
  });

  it("prints the whole exploration as JSON with --json", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    const shown = await cli(["show", ID, "--json"]);
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.out)).toMatchObject({ id: ID, title: "Prova", sources: [] });
    const journal = await cli(["journal", ID, "--text", "Voce", "--json"]);
    expect(JSON.parse(journal.out)).toMatchObject({ id: ID, journal: [{ via: "cli", text: "Voce" }] });
    const list = await cli(["list", "--json"]);
    expect(JSON.parse(list.out)).toHaveLength(1);
  });

  it("lists explorations in a table, and says so when there are none", async () => {
    expect((await cli(["list"])).out).toBe("Nessuna esplorazione.\n");
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    const listed = await cli(["list"]);
    expect(listed.out).toContain("ID");
    expect(listed.out).toContain(ID);
  });

  it("reads note and journal text from stdin with --text-file -", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    await cli(["note", ID, "--text-file", "-"], { stdin: "Da stdin\n" });
    const shown = await cli(["show", ID, "--json"]);
    expect(JSON.parse(shown.out).notes[0].body).toBe("Da stdin");
  });

  it("resolves text files and EPUBs against the user's working directory", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    await writeFile(path.join(work, "testo.md"), "Da file");
    expect((await cli(["journal", ID, "--text-file", "testo.md"])).code).toBe(0);
    await writeFile(path.join(work, "genealogia.epub"), FAKE_EPUB);
    const added = await cli(["add", ID, "--epub", "genealogia.epub"]);
    expect(added.code).toBe(0);
    expect(added.out).toContain("Fonte aggiunta: «Genealogia della morale».");
    const shown = JSON.parse((await cli(["show", ID, "--json"])).out);
    expect(shown.journal[0].text).toBe("Da file");
    expect(shown.sources[0]).toMatchObject({ origin: "explore", epub: { fileName: "genealogia.epub" } });
  });

  it("creates an exploration with an EPUB upload", async () => {
    await writeFile(path.join(work, "g.epub"), FAKE_EPUB);
    const created = await cli(["new", "--title", "Con EPUB", "--question", "Q", "--epub", "g.epub"]);
    expect(created.code).toBe(0);
    const id = created.out.split("\n")[0];
    expect(JSON.parse((await cli(["show", id!, "--json"])).out).sources).toHaveLength(1);
  });

  it("writes the summary and clears it", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    await cli(["summary", ID, "--text", "Sintesi"]);
    expect(JSON.parse((await cli(["show", ID, "--json"])).out).summary).toBe("Sintesi");
    expect((await cli(["summary", ID, "--clear"])).out).toContain("Sintesi rimossa.");
    expect(JSON.parse((await cli(["show", ID, "--json"])).out).summary).toBeNull();
  });

  it("removes a source", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q", "--book", "78w462eb"]);
    const removed = await cli(["remove", ID, "--book", "78w462eb"]);
    expect(removed.code).toBe(0);
    expect(JSON.parse((await cli(["show", ID, "--json"])).out).sources).toEqual([]);
  });

  it("prepares the sources: sizes, tokens, strategy", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q", "--book", "78w462eb"]);
    const prepared = await cli(["prepare", ID]);
    expect(prepared.code).toBe(0);
    // Italian grouping starts at five digits: 1000 stays "1000".
    expect(prepared.out).toContain("1 capitoli, 1000 parole, ~1400 token");
    expect(prepared.out).toContain("Strategia: intero");
    const tight = await cli(["prepare", ID, "--budget", "100", "--json"]);
    expect(JSON.parse(tight.out)).toMatchObject({ strategy: "per capitoli", budget: 100 });
  });

  it("exits 1 when validate finds an invalid file, and names it", async () => {
    await writeFile(path.join(dir, "2026-01-01-rotta.json"), "{}");
    const validated = await cli(["validate"]);
    expect(validated.code).toBe(1);
    expect(validated.err).toContain("2026-01-01-rotta.json");
    expect(validated.out).toContain("1 file non valido/i");
  });

  it("exits 1 with Italian messages for domain errors", async () => {
    const missing = await cli(["show", "2026-11-12-assente"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("errore: Esplorazione non trovata.");
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    const unknownBook = await cli(["add", ID, "--book", "zzzzzzzz"]);
    expect(unknownBook.code).toBe(1);
    expect(unknownBook.err).toContain("Libro «zzzzzzzz» non trovato in libreria.");
    const missingFile = await cli(["add", ID, "--epub", "non-esiste.epub"]);
    expect(missingFile.code).toBe(1);
    expect(missingFile.err).toContain("File non trovato");
  });

  it("exits 2 on wrong usage", async () => {
    const cases: string[][] = [
      ["unknown-command"],
      ["verdict", ID, "--book", "78w462eb", "--decision", "all"],
      ["verdict", ID, "--book", "78w462eb", "--decision", "maybe", "--reason", "x"],
      ["verdict", ID, "--book", "78w462eb", "--decision", "parts", "--chapters", "a,2", "--reason", "x"],
      ["add", ID, "--book", "78w462eb", "--epub", "x.epub"],
      ["add", ID],
      ["note", ID, "--text", "a", "--text-file", "b"],
      ["note", ID],
      ["summary", ID, "--clear", "--text", "x"],
      ["prepare", ID, "--budget", "0"],
      ["new", "--title", "Solo titolo"],
    ];
    for (const argv of cases) {
      const result = await cli(argv);
      expect(result.code, argv.join(" ")).toBe(2);
    }
  });

  it("exits 0 for --help", async () => {
    const help = await cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("verdict");
  });
});

describe("explore CLI: notebook", () => {
  it("replaces, appends to and clears the notebook, and show prints it", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    expect((await cli(["show", ID])).out).toMatch(/Quaderno\n\s+Vuoto/);

    const replaced = await cli(["notebook", ID, "--text", "# Primo"]);
    expect(replaced.code).toBe(0);
    expect(replaced.out).toContain("Quaderno salvato.");
    expect((await cli(["show", ID])).out).toContain("# Primo");

    const appended = await cli(["notebook", ID, "--text", "Secondo", "--append", "--via", "skill"]);
    expect(appended.out).toContain("Testo aggiunto al quaderno.");
    const shown = await cli(["show", ID]);
    expect(shown.out).toMatch(/# Primo\n\s*\n\s+Secondo/);

    const json = await cli(["notebook", ID, "--text-file", "-", "--append", "--json"], { stdin: "Terzo\n" });
    expect(JSON.parse(json.out)).toMatchObject({ notebook: { body: "# Primo\n\nSecondo\n\nTerzo", via: "cli" } });

    const cleared = await cli(["notebook", ID, "--clear"]);
    expect(cleared.out).toContain("Quaderno svuotato.");
    expect((await cli(["show", ID])).out).toMatch(/Quaderno\n\s+Vuoto/);
  });

  it("refuses --clear with --append or --text, and a missing source of text", async () => {
    await cli(["new", "--title", "Prova", "--question", "Q"]);
    expect((await cli(["notebook", ID, "--clear", "--append"])).code).toBe(2);
    expect((await cli(["notebook", ID, "--clear", "--text", "x"])).code).toBe(2);
    expect((await cli(["notebook", ID])).code).toBe(2);
    expect((await cli(["notebook", ID, "--text", "  ", "--append"])).code).toBe(1);
  });
});

describe("explore tags and kobo", () => {
  async function newWithEpub(title: string, ...extra: string[]) {
    await writeFile(path.join(work, "g.epub"), FAKE_EPUB);
    const created = await cli(["new", "--title", title, "--question", "Q", "--epub", "g.epub", ...extra]);
    expect(created.code).toBe(0);
    return created.out.split("\n")[0]!;
  }

  it("sets, adds, removes and filters tags", async () => {
    const id = await newWithEpub("Prova");
    expect((await cli(["tag", id, "--add", "Filosofia", "--add", "etica", "--add", "filosofia"])).out).toContain(
      "Tag: etica, filosofia.",
    );
    expect((await cli(["tag", id, "--remove", "etica"])).out).toContain("Tag: filosofia.");
    expect((await cli(["tag", id])).out.trim()).toBe("filosofia");
    expect((await cli(["list", "--tag", "filosofia"])).out).toContain(id);
    expect((await cli(["list", "--tag", "storia"])).out).toContain("Nessuna esplorazione.");
    expect((await cli(["tag", id, "--set", ""])).out).toContain("Tag: nessuno.");
    expect((await cli(["tag", id, "--set", "a", "--add", "b"])).code).toBe(2);
  });

  it("adds the explore books of the tagged explorations to the library under a topic, skipping library books", async () => {
    const id = await newWithEpub("Prova", "--book", "78w462eb");
    await cli(["tag", id, "--add", "filosofia"]);
    const promoted: { id: string; topic: string }[] = [];
    const deps = {
      ...fakeLibrary(),
      listLibraryTopics: async () => [
        { id: "saggistica", label: "Saggistica" },
        { id: "filosofia", label: "Filosofia" },
      ],
      promoteExploreBook: async (input: { id: string; topic: string }) => {
        promoted.push(input);
        return { book: {}, report: { dryRun: false, actions: [], warnings: [], errors: [] } } as never;
      },
      formatKoboReport: () => ["fatto"],
    };
    const run = async (argv: string[]) => {
      const io = captureIo(work, "");
      const code = await runCli(argv, io.io, deps as never);
      return { code, out: io.stdout(), err: io.stderr() };
    };

    const dry = await run(["kobo", "--tag", "filosofia", "--topic", "Filosofia", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(promoted).toEqual([]);
    expect(dry.err).toContain("già in libreria: 1");

    const real = await run(["kobo", "--tag", "filosofia", "--topic", "filosofia"]);
    expect(real.code).toBe(0);
    expect(promoted).toEqual([{ id: "ex000001", topic: "filosofia" }]);
    // The source is a library source now.
    const shown = JSON.parse((await cli(["show", id, "--json"])).out);
    expect(shown.sources.find((s: { id: string }) => s.id === "ex000001")).toMatchObject({ origin: "library" });
    expect(shown.sources.find((s: { id: string }) => s.id === "ex000001").epub).toBeUndefined();

    expect((await run(["kobo", "--tag", "filosofia", "--topic", "nope"])).code).toBe(0); // nothing left to add
    expect((await run(["kobo"])).code).toBe(1);
  });

  it("asks for a known topic", async () => {
    const id = await newWithEpub("Prova");
    const deps = { ...fakeLibrary(), listLibraryTopics: async () => [{ id: "filosofia", label: "Filosofia" }] };
    const run = async (argv: string[]) => {
      const io = captureIo(work, "");
      return { code: await runCli(argv, io.io, deps as never), err: io.stderr() };
    };
    expect((await run(["kobo", "--id", id])).code).toBe(2);
    const unknown = await run(["kobo", "--id", id, "--topic", "storia"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("filosofia");
  });
});
