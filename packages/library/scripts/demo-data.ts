/**
 * Writes a demo data dir (topics.json + public-domain books with covers and notes) for developing the SPA:
 *
 *   pnpm demo-data [dir]                                   # default: <os tmpdir>/elib-demo-data
 *   ELIB_DATA_DIR=<dir> pnpm exec vite --port 5199
 *
 * The dir must be outside the repository (the repo is public: demo books never go into data/).
 * Book IDs are deterministic, so re-running overwrites the same folders and touches nothing else.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateBookId } from "../src/shared/ids.ts";
import type { Book, BookStatus, Topic } from "../src/shared/schema.ts";
import { REPO_ROOT } from "../src/node/config/index.ts";
import {
  bookDir,
  coverPath,
  markdownPath,
  readTopics,
  writeBook,
  writeTopics,
} from "../src/node/repo/index.ts";

// ---------------------------------------------------------------------------------------------
// Demo content (descriptions and notes written for this demo; all works are in the public domain)
// ---------------------------------------------------------------------------------------------

type CoverStyle = "frame" | "band" | "disc" | "spine";

interface DemoBook {
  title: string;
  authors: string[];
  topic: string;
  status: BookStatus;
  tags?: string[];
  startedAt?: string;
  finishedAt?: string;
  rating?: number;
  isbn?: string;
  publisher?: string;
  language?: string;
  description?: string;
  subjects?: string[];
  /** null = no cover.webp (the SPA shows its typographic placeholder). */
  cover: { style: CoverStyle; bg: string; fg: string; accent: string; height?: number } | null;
  notes?: string;
  recall?: string;
  study?: string;
}

const EXTRA_TOPICS: Topic[] = [
  { id: "poesia", label: "Poesia" },
  { id: "storia-politica", label: "Storia e politica" },
];

const BOOKS: DemoBook[] = [
  {
    title: "I promessi sposi",
    authors: ["Alessandro Manzoni"],
    topic: "narrativa",
    status: "read",
    tags: ["classici", "romanzo storico", "Ottocento"],
    startedAt: "2025-01-07",
    finishedAt: "2025-03-02",
    rating: 5,
    publisher: "Liber Liber",
    language: "it",
    description:
      "Lombardia, 1628: il matrimonio di Renzo e Lucia salta per il capriccio di un signorotto, e i due vengono travolti da carestia, rivolte, guerra e peste.\n\nUn romanzo sulla Provvidenza e sulla giustizia che non arriva, raccontato da un narratore ironico che non perde mai di vista i più piccoli.",
    subjects: ["Fiction", "Italy -- History -- 1559-1789 -- Fiction", "Romanzo storico"],
    cover: { style: "frame", bg: "#1f3a5f", fg: "#f3ead8", accent: "#c9a45c" },
    notes: `## Struttura

Il romanzo alterna **storie private** e **grande storia**: la guerra, la carestia e la peste non fanno da sfondo, decidono le vite dei personaggi.

- *Capitoli I–VIII*: il paese, il sopruso, la fuga.
- *Capitoli IX–XXVII*: le strade si dividono (Lucia a Monza, Renzo a Milano).
- *Capitoli XXVIII–XXXVIII*: carestia, peste, ricongiungimento.

### Il narratore

Manzoni finge di trascrivere un manoscritto secentesco e lo commenta: l'ironia nasce dalla distanza tra lo stile dell'«anonimo» e il suo.

> «Questo matrimonio non s'ha da fare» è la frase che mette in moto tutto il resto.

## Personaggi

| Personaggio | Ruolo | Nota |
| --- | --- | --- |
| Don Abbondio | curato | la paura come regola di vita |
| Fra Cristoforo | frate | la conversione come scelta quotidiana |
| L'Innominato | signore | la notte della crisi, il cambiamento |

---

Da rileggere: il capitolo sulla notte dell'Innominato e l'addio ai monti.
`,
    recall: `- La **Provvidenza** non è un premio: agisce dentro la storia, spesso in modo indiretto.
- Il potere (Don Rodrigo, l'Azzeccagarbugli) si regge sulla paura dei deboli.
- La peste livella tutti: è il punto in cui i destini si sciolgono.
`,
  },
  {
    title: "Il Principe",
    authors: ["Niccolò Machiavelli"],
    topic: "storia-politica",
    status: "read",
    tags: ["classici", "Rinascimento", "potere"],
    startedAt: "2025-04-01",
    finishedAt: "2025-04-18",
    rating: 4,
    publisher: "Wikisource",
    language: "it",
    description:
      "Breve trattato sul modo di conquistare e conservare lo Stato, scritto nel 1513 e dedicato a Lorenzo de' Medici. Separa la politica dalla morale e guarda alla «verità effettuale» delle cose.",
    subjects: ["Political science", "Political ethics"],
    cover: { style: "band", bg: "#7a1f1f", fg: "#f5ecdc", accent: "#111111" },
    notes: `## Idee centrali

1. **Virtù e fortuna**: la fortuna governa metà delle azioni umane; l'altra metà dipende da noi.
2. **Verità effettuale**: descrivere come gli uomini vivono, non come dovrebbero vivere.
3. **Essere temuti o amati**: meglio entrambe le cose; potendone scegliere una, meglio temuti, ma mai odiati.

### Contesto

Scritto durante l'esilio all'Albergaccio, dopo la caduta della Repubblica fiorentina. Il capitolo finale è un'esortazione a liberare l'Italia.
`,
    recall: `- Politica come tecnica: il giudizio sui mezzi dipende dai fini e dalle circostanze.
- La fortuna è un fiume in piena: si costruiscono argini quando il tempo è calmo.
`,
  },
  {
    title: "La coscienza di Zeno",
    authors: ["Italo Svevo"],
    topic: "narrativa",
    status: "reading",
    tags: ["Novecento", "psicoanalisi"],
    startedAt: "2025-10-20",
    publisher: "Liber Liber",
    language: "it",
    description:
      "Zeno Cosini scrive le proprie memorie su invito del suo psicanalista: l'ultima sigaretta, la morte del padre, un matrimonio quasi per sbaglio, gli affari. Un narratore inaffidabile e comicissimo.",
    cover: { style: "disc", bg: "#e7dcc4", fg: "#2b2620", accent: "#b8472f" },
  },
  {
    title: "La Divina Commedia",
    authors: ["Dante Alighieri"],
    topic: "poesia",
    status: "reading",
    tags: ["classici", "Medioevo", "poema"],
    startedAt: "2025-09-01",
    publisher: "Liber Liber",
    language: "it",
    description:
      "Il viaggio di Dante attraverso Inferno, Purgatorio e Paradiso, in cento canti di terzine incatenate. Enciclopedia del sapere medievale e racconto di una conversione personale.",
    subjects: ["Poetry", "Hell -- Poetry", "Purgatory -- Poetry", "Paradise -- Poetry"],
    cover: { style: "frame", bg: "#2d2a26", fg: "#efe4cc", accent: "#b9893f" },
    notes: `## Inferno

La struttura morale segue Aristotele (incontinenza, violenza, frode) più che i sette vizi capitali.

### Canti da ricordare

- **V** — Paolo e Francesca: la pietà del pellegrino e la condanna del poeta.
- **X** — Farinata: la politica fiorentina dentro l'aldilà.
- **XXVI** — Ulisse: il «folle volo» e i limiti della conoscenza.

## Metodo di lettura

Un canto al giorno, prima la parafrasi e poi il testo ad alta voce. Il commento solo alla fine.
`,
    recall: `- Tre cantiche, 33 canti ciascuna più il proemio: **100** in tutto.
- La *contrapasso* lega la pena alla colpa per analogia o per contrasto.
- Virgilio guida fino al Paradiso terrestre; poi Beatrice.
`,
    study: `## Domande di studio

**Perché Ulisse è all'Inferno?** Per la frode (il cavallo di Troia), non per la sete di conoscenza. Ma Dante gli dà la parola più alta del canto: la condanna e l'ammirazione convivono.

**Che cosa cambia tra Inferno e Purgatorio?** Il tempo: nel Purgatorio le anime aspettano, sperano e cantano insieme.

### Da approfondire

1. La figura di Catone come custode del Purgatorio.
2. Il rapporto tra Dante personaggio e Dante autore.
`,
  },
  {
    title: "Pensieri",
    authors: ["Marco Aurelio"],
    topic: "filosofia",
    status: "read",
    tags: ["stoicismo", "classici"],
    startedAt: "2024-11-02",
    finishedAt: "2024-12-15",
    rating: 5,
    language: "it",
    description:
      "Gli appunti personali di un imperatore romano, scritti in greco durante le campagne militari: esercizi quotidiani di disciplina interiore, mai pensati per essere pubblicati.",
    subjects: ["Stoics", "Ethics"],
    cover: { style: "spine", bg: "#d9cbb0", fg: "#3a2f22", accent: "#6b4f2d" },
    notes: `## Temi

- **Ciò che dipende da noi**: giudizi, impulsi, desideri. Il resto è indifferente.
- **Impermanenza**: tutto passa in fretta, anche la fama.
- **Dovere sociale**: siamo fatti per collaborare, come le mani e i piedi.

> «Al mattino di' a te stesso: incontrerò un ingrato, un violento, un invidioso…»

Il libro non argomenta: ripete. È un quaderno di esercizi, non un trattato.
`,
    recall: `- Separare il fatto dal giudizio sul fatto.
- Ogni giorno è un esercizio, non un risultato.
`,
  },
  {
    title: "Pride and Prejudice",
    authors: ["Jane Austen"],
    topic: "narrativa",
    status: "read",
    tags: ["classici", "Ottocento", "in inglese"],
    startedAt: "2024-06-10",
    finishedAt: "2024-07-04",
    rating: 4,
    publisher: "Project Gutenberg",
    language: "en",
    description:
      "Elizabeth Bennet e Mr Darcy si giudicano male al primo incontro e passano il romanzo a correggersi. Commedia di costume sul matrimonio, il denaro e l'orgoglio.",
    subjects: ["Fiction", "Courtship -- Fiction", "England -- Fiction"],
    cover: { style: "band", bg: "#8fa79a", fg: "#1d2a24", accent: "#f2ede2" },
  },
  {
    title: "Delitto e castigo",
    authors: ["Fëdor Dostoevskij"],
    topic: "narrativa",
    status: "read",
    tags: ["classici", "russi", "Ottocento"],
    startedAt: "2025-05-03",
    finishedAt: "2025-06-21",
    rating: 5,
    language: "it",
    description:
      "Raskol'nikov, studente povero a Pietroburgo, uccide una vecchia usuraia per dimostrare a sé stesso di essere un uomo straordinario. Il resto del romanzo è il castigo: febbre, sospetto, confessione.",
    cover: { style: "disc", bg: "#1b1b1f", fg: "#e9e2d0", accent: "#9e2b25" },
    recall: `- L'idea dell'«uomo straordinario» crolla davanti alle conseguenze concrete.
- Porfirij non ha prove: aspetta che sia la coscienza a parlare.
`,
  },
  {
    title: "I fratelli Karamazov",
    authors: ["Fëdor Dostoevskij"],
    topic: "narrativa",
    status: "to-read",
    tags: ["classici", "russi"],
    language: "it",
    description:
      "Un padre dissoluto, tre fratelli (più un quarto illegittimo) e un parricidio. L'ultimo romanzo di Dostoevskij, con la Leggenda del Grande Inquisitore.",
    cover: { style: "frame", bg: "#4a3b2a", fg: "#f1e6cf", accent: "#d0a85c", height: 780 },
  },
  {
    title: "Il fu Mattia Pascal",
    authors: ["Luigi Pirandello"],
    topic: "narrativa",
    status: "read",
    tags: ["Novecento", "identità"],
    startedAt: "2023-09-01",
    finishedAt: "2023-09-20",
    language: "it",
    description:
      "Creduto morto, Mattia Pascal coglie l'occasione per rifarsi una vita sotto falso nome, e scopre che senza un'identità riconosciuta non si vive affatto.",
    cover: { style: "spine", bg: "#c8553d", fg: "#fff4e4", accent: "#2b2118" },
  },
  {
    title: "I Malavoglia",
    authors: ["Giovanni Verga"],
    topic: "narrativa",
    status: "to-read",
    tags: ["verismo", "Ottocento"],
    language: "it",
    description:
      "Una famiglia di pescatori di Aci Trezza perde la barca, il carico e la casa. Il primo romanzo del ciclo dei Vinti.",
    cover: null,
  },
  {
    title: "Le confessioni",
    authors: ["Agostino d'Ippona"],
    topic: "filosofia",
    status: "abandoned",
    tags: ["tardo antico", "autobiografia"],
    startedAt: "2024-02-01",
    language: "it",
    description:
      "Un'autobiografia in forma di preghiera: l'infanzia, gli studi a Cartagine, il manicheismo, Milano e la conversione. Gli ultimi libri riflettono sul tempo e sulla memoria.",
    cover: { style: "band", bg: "#5b4b6b", fg: "#f3eadf", accent: "#d8c08a" },
  },
  {
    title: "Discorso sul metodo",
    authors: ["René Descartes"],
    topic: "filosofia",
    status: "read",
    tags: ["Seicento", "razionalismo"],
    startedAt: "2025-07-01",
    finishedAt: "2025-07-09",
    language: "it",
    description:
      "Quattro regole per condurre bene la ragione, raccontate come un'autobiografia intellettuale. Contiene il «penso, dunque sono».",
    cover: { style: "disc", bg: "#f0e9da", fg: "#1f2a3a", accent: "#2f5d8a" },
    study: `## Le quattro regole

1. Non accettare nulla per vero che non sia evidente.
2. Dividere ogni difficoltà in parti.
3. Procedere dal semplice al complesso.
4. Fare enumerazioni complete.

**Obiezione da discutere:** l'evidenza è un criterio psicologico o logico?
`,
  },
  {
    title: "Moby-Dick",
    authors: ["Herman Melville"],
    topic: "narrativa",
    status: "abandoned",
    tags: ["classici", "mare", "in inglese"],
    startedAt: "2023-06-01",
    publisher: "Project Gutenberg",
    language: "en-US",
    description:
      "Il capitano Achab insegue la balena bianca che gli ha strappato una gamba. Romanzo d'avventura, trattato di cetologia e meditazione sul male, tutto insieme.",
    cover: { style: "frame", bg: "#20414f", fg: "#e8f0ef", accent: "#88b3bf" },
  },
  {
    title: "Anna Karenina",
    authors: ["Lev Tolstoj"],
    topic: "narrativa",
    status: "reading",
    tags: ["classici", "russi"],
    startedAt: "2025-10-28",
    language: "it",
    description:
      "Due storie parallele: la passione di Anna per Vronskij, che la mette contro la società di Pietroburgo, e la ricerca di senso di Levin in campagna.",
    cover: { style: "spine", bg: "#2e4a3a", fg: "#f2ead8", accent: "#c49a52" },
  },
  {
    title: "Canti",
    authors: ["Giacomo Leopardi"],
    topic: "poesia",
    status: "read",
    tags: ["Ottocento", "lirica"],
    startedAt: "2024-03-10",
    finishedAt: "2024-04-02",
    rating: 5,
    language: "it",
    description:
      "La raccolta delle poesie di Leopardi, dalle canzoni civili agli idilli, ai canti pisano-recanatesi fino alla Ginestra.",
    cover: { style: "disc", bg: "#273b5c", fg: "#f5efe2", accent: "#e1b866" },
  },
  {
    title: "L'origine delle specie",
    authors: ["Charles Darwin"],
    topic: "saggistica",
    status: "to-read",
    tags: ["scienza", "evoluzione"],
    language: "it",
    description:
      "L'argomento a favore della selezione naturale, costruito con pazienza su allevamento, biogeografia, fossili e anatomia comparata.",
    cover: null,
  },
  {
    title: "Decameron",
    authors: ["Giovanni Boccaccio"],
    topic: "unsorted",
    status: "to-read",
    language: "it",
    cover: null,
  },
  {
    title: "Lettere a Lucilio",
    authors: ["Lucio Anneo Seneca"],
    topic: "filosofia",
    status: "reading",
    tags: ["stoicismo", "classici"],
    startedAt: "2025-08-15",
    language: "it",
    description: "Centoventiquattro lettere a un amico più giovane: un corso di filosofia pratica.",
    cover: { style: "band", bg: "#b08d57", fg: "#221a10", accent: "#f6efe0" },
  },
  {
    title: "Frankenstein, or The Modern Prometheus",
    authors: ["Mary Shelley"],
    topic: "unsorted",
    status: "to-read",
    tags: ["gotico", "in inglese"],
    language: "en",
    cover: { style: "frame", bg: "#3b3f2e", fg: "#e8e3cf", accent: "#9fae6e" },
  },
  {
    title: "Storia della colonna infame",
    authors: ["Alessandro Manzoni"],
    topic: "storia-politica",
    status: "to-read",
    tags: ["Seicento", "giustizia"],
    language: "it",
    description:
      "Il processo agli «untori» del 1630 ricostruito sui documenti: un'inchiesta sulla responsabilità personale dei giudici.",
    cover: { style: "spine", bg: "#6d6a62", fg: "#f4f0e6", accent: "#2a2723" },
  },
];

// ---------------------------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------------------------

const SERIF = "Noto Serif Display, Noto Serif, DejaVu Serif, Georgia, serif";
const SANS = "Inter, Noto Sans, DejaVu Sans, sans-serif";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Greedy word wrap by character count (good enough for a demo cover). */
function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(
  lines: string[],
  x: number,
  y: number,
  opts: {
    size: number;
    family: string;
    fill: string;
    anchor?: string;
    weight?: number;
    spacing?: number;
  },
): string {
  const lh = opts.size * 1.18;
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * lh}" font-family="${opts.family}" font-size="${opts.size}" font-weight="${opts.weight ?? 500}" fill="${opts.fill}" text-anchor="${opts.anchor ?? "middle"}" letter-spacing="${opts.spacing ?? 0}">${escapeXml(l)}</text>`,
    )
    .join("");
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** Whichever of the two colors contrasts more with the background. */
function contrastOn(background: string, a: string, b: string): string {
  const l = luminance(background);
  const ratio = (c: string) => {
    const lc = luminance(c);
    return (Math.max(l, lc) + 0.05) / (Math.min(l, lc) + 0.05);
  };
  return ratio(a) >= ratio(b) ? a : b;
}

function coverSvg(book: DemoBook, width: number, height: number): string {
  const c = book.cover;
  if (!c) throw new Error("no cover");
  const author = (book.authors[0] ?? "").toUpperCase();
  const titleLines = wrap(book.title, c.style === "spine" ? 10 : book.title.length > 24 ? 14 : 12);
  const size = titleLines.length > 2 ? 54 : 64;
  let body = "";
  switch (c.style) {
    case "frame":
      body = `<rect x="34" y="34" width="${width - 68}" height="${height - 68}" fill="none" stroke="${c.accent}" stroke-width="3"/>
<rect x="46" y="46" width="${width - 92}" height="${height - 92}" fill="none" stroke="${c.accent}" stroke-width="1"/>
${textBlock([author], width / 2, 150, { size: 22, family: SANS, fill: c.accent, spacing: 4 })}
${textBlock(titleLines, width / 2, height * 0.42, { size, family: SERIF, fill: c.fg })}
<text x="${width / 2}" y="${height - 120}" font-family="${SERIF}" font-size="40" fill="${c.accent}" text-anchor="middle">❦</text>`;
      break;
    case "band":
      body = `<rect x="0" y="${height * 0.34}" width="${width}" height="${height * 0.34}" fill="${c.accent}" opacity="0.92"/>
${textBlock(titleLines, width / 2, height * 0.34 + 110, { size, family: SERIF, fill: contrastOn(c.accent, c.bg, c.fg) })}
${textBlock([author], width / 2, height - 110, { size: 24, family: SANS, fill: c.fg, spacing: 3 })}`;
      break;
    case "disc":
      body = `<circle cx="${width / 2}" cy="${height * 0.38}" r="${width * 0.3}" fill="${c.accent}"/>
<circle cx="${width / 2}" cy="${height * 0.38}" r="${width * 0.3 - 18}" fill="none" stroke="${c.bg}" stroke-width="2"/>
${textBlock(titleLines, width / 2, height * 0.74, { size: size * 0.9, family: SERIF, fill: c.fg })}
${textBlock([author], width / 2, 90, { size: 22, family: SANS, fill: c.fg, spacing: 4 })}`;
      break;
    case "spine":
      body = `<rect x="0" y="0" width="70" height="${height}" fill="${c.accent}"/>
<rect x="70" y="0" width="6" height="${height}" fill="${c.fg}" opacity="0.35"/>
${textBlock(titleLines, 120, 210, { size, family: SERIF, fill: c.fg, anchor: "start" })}
<rect x="120" y="${height - 190}" width="120" height="3" fill="${c.fg}"/>
${textBlock([author], 120, height - 140, { size: 24, family: SANS, fill: c.fg, anchor: "start", spacing: 3 })}`;
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${c.bg}"/>
${body}
</svg>`;
}

async function writeCover(file: string, book: DemoBook): Promise<void> {
  const width = 600;
  const height = book.cover?.height ?? 900;
  const webp = await sharp(Buffer.from(coverSvg(book, width, height)))
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(file, webp);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32), so the demo IDs are the same on every run. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function main(): Promise<void> {
  const target = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "elib-demo-data"));
  if (isInside(target, REPO_ROOT)) {
    console.error(
      `demo-data: refusing to write inside the repository (${target}). The repo is public: pick a dir outside it.`,
    );
    process.exit(1);
  }

  await mkdir(path.join(target, "books"), { recursive: true });

  const repoTopics = await readTopics(path.join(REPO_ROOT, "data"));
  const topics = [
    ...repoTopics,
    ...EXTRA_TOPICS.filter((t) => !repoTopics.some((r) => r.id === t.id)),
  ];
  await writeTopics(target, topics);

  const rng = seededRng(20251110);
  const ids = new Set<string>();
  let covers = 0;
  let markdown = 0;
  for (const demo of BOOKS) {
    const id = generateBookId(ids, rng);
    ids.add(id);
    // Only this book's own folder is replaced: nothing else in the target dir is touched.
    await rm(bookDir(target, id), { recursive: true, force: true });
    const { cover, notes, recall, study, ...meta } = demo;
    const book: Book = { id, ...meta };
    await writeBook(target, book);
    if (cover) {
      await writeCover(coverPath(target, id), demo);
      covers += 1;
    }
    for (const [kind, text] of [
      ["notes", notes],
      ["recall", recall],
      ["study", study],
    ] as const) {
      if (text === undefined) continue;
      await writeFile(markdownPath(target, id, kind), text);
      markdown += 1;
    }
  }

  console.log(
    `demo-data: wrote ${topics.length} topics, ${BOOKS.length} books (${covers} covers, ${markdown} Markdown files) to ${target}`,
  );
  console.log(`\nRun the SPA on it:\n  ELIB_DATA_DIR=${target} pnpm exec vite --port 5199\n`);
}

await main();
