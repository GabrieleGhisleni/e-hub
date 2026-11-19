# Esplorazioni — Piano

Piano ad alto livello, senza codice. Raccoglie le decisioni prese nella sessione del 10 novembre 2026, aggiornate il 12 novembre dopo l'arrivo della chat AI nell'app ([chat.md](chat.md)) e con la v1 implementata la sera stessa (§12). Quando una scelta cambia, va aggiornato questo file.

---

## 1. Cos'è

Un modo per **esplorare libri e podcast con l'agente prima di leggerli o ascoltarli**, partendo da una domanda. Per esempio: _"Nietzsche e la critica alla morale cristiana"_.

- **Al centro c'è la domanda, non il libro.** Un'esplorazione raccoglie più fonti (libri della libreria, episodi dei podcast) attorno a un tema.
- **Lo scopo è il triage**: capire cosa dicono le fonti sul tema, dove ne parlano e se vale la pena leggerle, tutte o in parte.
- **Il risultato è un verdetto per fonte**: _leggere tutto_, _leggere i capitoli 2 e 5_, _non leggere_, con una riga di motivazione. Più le note che decido di tenere.

Rispetto alla **skill di studio** (PLAN della libreria, §11-bis): l'esplorazione viene **prima** della lettura e lavora su più fonti; lo studio viene **durante o dopo** e lavora su un libro solo. Le due skill condividono lo stesso accesso al testo (§4).

## 2. Principi

| Decisione               | Scelta                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Due strade, che coesistono | **Skill di Claude Code** (con la mia subscription) **e chat nell'app** (`@ehub/chat`, endpoint OpenAI-compatibile, solo in locale). Lavorano sugli stessi dati: un'esplorazione nata in una si può continuare o chiudere nell'altra |
| Dati in comune          | **Un solo formato** di file di esplorazione e **una sola validazione** (CLI/server locale). Né la skill né l'app scrivono JSON a mano  |
| Accesso al testo in comune | Skill e app usano gli stessi pezzi: `elib text`, le sintesi `summary.json`, le trascrizioni locali. Nell'app passano dai tool della chat (`read_chapter`, `search_book`…); nella skill dalla CLI |
| Interfaccia all'agente  | Skill: la CLI che esiste già. App: i tool della chat. **Niente server MCP**                                            |
| Accesso al testo        | **Contesto lungo** (1M token): i libri si caricano interi quando ci stanno; altrimenti indice, capitoli scelti e `grep` |
| RAG, embedding, indici  | **Non nella v1**. Si aggiungono solo davanti a un problema concreto (§8)                                               |
| Testi, trascrizioni     | **Mai nel repo**: restano nella cache locale, come già oggi                                                            |
| Fonti nella v1          | **Solo libri**. Gli episodi dei podcast sono rimandati: il formato ha già il campo `kind`, così si aggiungono senza migrare i file |
| Libri non in libreria   | **Solo da esplorare**: l'EPUB resta nella cache locale e non entra in libreria; sul Kobo ci va solo se lo chiedi, con `explore kobo` (§13) |
| Note                    | **Nel file di esplorazione**, non nel pacchetto `notes`: riguardano la domanda, e così c'è un solo percorso di scrittura |
| Cosa si pubblica        | Esplorazione, verdetti e note, scritti con parole mie o dell'agente, con citazioni brevi                               |

## 3. Flusso

1. **Avvio**, in uno dei due modi:
   - **skill**: la lancio con la domanda e le fonti (ID dei libri, slug degli episodi);
   - **app**: una pagina "Nuova esplorazione" (solo in locale) per scrivere la domanda e scegliere le fonti; poi si apre la chat sull'esplorazione.

   In entrambi i casi l'esplorazione si salva subito nel formato comune (§5). Un libro che non è in libreria si aggiunge come EPUB "solo da esplorare" e non entra in libreria (§12).
2. **Preparazione del testo**: per ogni libro, `elib text <id>` (capitoli in Markdown nella cache) e, se c'è, `summary.json`. Per gli episodi, la trascrizione locale.
3. **Scelta della strategia**: si stima la dimensione totale (§4) e si decide se caricare tutto o lavorare per capitoli. Nell'app di partenza ci sono le sintesi delle fonti, e i capitoli e le trascrizioni si leggono con i tool.
4. **Esplorazione**: chat libera. Ogni affermazione sulle fonti cita libro e capitolo (o episodio e minuto).
5. **Chiusura**: l'agente propone verdetti per fonte e note. **Li rivedo io** prima che vengano scritti nel repo.
6. **Pubblicazione**: commit e push, come per il resto dei dati.

## 4. Accesso al testo

- **Libri**: `elib text <id>` produce un file Markdown per capitolo in `~/.cache/e-library` e un manifest con titolo e numero di parole di ogni capitolo. Se l'EPUB non è in cache non può estrarre nulla (la cache è l'unica copia locale degli EPUB).
- **Podcast**: le trascrizioni che esistono già in locale (`packages/podcasts/data/transcripts`, fuori da git).
- **Regola del budget**: la skill somma le parole dal manifest e le converte in token (circa 1,3–1,5 token per parola, a seconda della lingua).
  - **Sotto la soglia** (proposta: circa 500k token in totale): si caricano le fonti intere.
  - **Sopra la soglia**: si caricano l'indice dei capitoli e solo i capitoli pertinenti, trovati con `grep`. L'agente espande la query con sinonimi e traduzioni (_pity_, _compassion_, _Mitleid_).
- **Citazioni letterali**: prima di riportarle, l'agente le verifica con `grep` sul capitolo. Sui contesti molto lunghi il ritrovamento di un passaggio preciso è meno affidabile del triage.
- **Permessi**: la cartella della cache sta fuori dal repo, quindi va aggiunta alle directory che l'agente può leggere.

## 5. Dati

**Nel repo (pubblicati):**

- **Esplorazione**: un file per esplorazione con titolo, domanda, data, fonti e, per ogni fonte, il verdetto (_leggere tutto_ / _leggere in parte_ / _non leggere_ / _da decidere_), i capitoli consigliati e la motivazione.
- **Sintesi**: un breve testo sull'esito dell'esplorazione.
- **Note**: le risposte utili diventano note dell'esplorazione, collegate facoltativamente a un libro. Stanno nello stesso file, non nel pacchetto `notes`.
- **Diario**: una voce per sessione (skill o app) con cosa è emerso e cosa resta da vedere. È il ponte tra le due strade.
- **Quaderno**: un solo documento Markdown condiviso per tutta l'esplorazione, accanto alle note separate (vedi §12, «Quaderno»).

**Solo in locale (cache, fuori da git):** testo dei capitoli, trascrizioni ed eventuali sottoprodotti futuri (mappe, indici).

**Lo "statuto speciale" del libro** non diventa un nuovo valore dello stato di lettura (_Da leggere_, _In lettura_, _Letto_, _Abbandonato_). Essere stato esplorato è un'informazione ortogonale: un libro può essere esplorato e poi letto. Si **ricava** dalle esplorazioni che lo citano e si mostra come badge con il verdetto nella pagina del libro.

## 6. Skill

`.claude/skills/explore/`, versionata nel repo. Contiene tutte le istruzioni:

- come preparare le fonti e applicare la regola del budget (§4);
- le regole di citazione e di verifica;
- il formato del file di esplorazione e dei verdetti;
- la chiusura: proposta di verdetti e note, revisione mia, scrittura.

La skill scrive i dati passando dalla validazione del progetto (CLI o server locale), non scrivendo JSON a mano.

## 7. App web

- **Vista `/explore`**: elenco delle esplorazioni, con domanda, fonti, verdetti e sintesi. Sul sito pubblicato è in sola lettura.
- **In locale**: la pagina "Nuova esplorazione" (domanda e fonti) e la **chat sull'esplorazione**, cioè la sorgente `exploration` di `@ehub/chat` ([chat.md](chat.md), Fase 6). Ha i tool su tutte le fonti e la chiusura con la proposta di verdetti, che rivedo io prima di salvarli.
- Le esplorazioni create dalla skill compaiono qui come le altre, e si possono continuare in chat. Vale anche il contrario.
- **Badge** nelle pagine di libri ed episodi: "Esplorato in: _Nietzsche e la morale cristiana_ — leggere i capitoli 2 e 5".
- Il codice vive nel nuovo pacchetto `packages/explore` (§12).

## 8. Fuori dalla v1, e quando rivalutare

| Cosa                                                       | Quando aggiungerla                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ~~Mappa del libro~~                                        | **Fatta** (12/11): `elib summarize` scrive `summary.json`, pubblicato. La usano sia la chat sia la skill                              |
| **Ricerca ibrida** (SQLite + FTS5 + sqlite-vec + Ollama)   | Se con molte fonti `grep` dà troppo rumore, o se trovo da solo passaggi rilevanti che l'agente non aveva visto. Diventa `elib search` |
| **Server MCP**                                             | Solo se un comando CLI non basta più. Oggi non c'è motivo                                                                          |
| **Conversazioni pubblicate** (come per i podcast)          | Se mi accorgo di volerle rileggere sul sito                                                                                        |

## 9. Fasi

1. **Dati**: il formato del file di esplorazione, la sua validazione, la scrittura via CLI e via server locale, e la scrittura delle note. Sono la base comune delle due strade.
2. **Skill**: `.claude/skills/explore/` sopra la CLI.
3. **App web**: vista `/explore`, pagina "Nuova esplorazione", chat sull'esplorazione con verdetti proposti e rivisti, badge su libri ed episodi.
4. **Solo se serve** (§8): ricerca ibrida.

Le fasi 2 e 3 dipendono solo dalla 1 e si possono fare in parallelo. **L'implementazione si fa in una sessione separata** da quella della chat.

Stato al 12/11: fasi 1, 2 e 3 fatte (v1, solo libri). Vedi §12.

## 10. Decisioni aperte

- **Soglia del budget**: 500k token è una proposta. Va tarata sull'uso reale, sui limiti della subscription (skill) e sui limiti dei piani gratuiti del router (app).
- **Conversazioni**: restano solo in locale o se ne pubblica una versione ripulita, come per i podcast?
- ~~**Libri non ancora in libreria**~~: **deciso il 12/11**, importazione leggera "solo per esplorare" (§12). Se poi decido di leggerlo, lo importo in libreria con il flusso normale (il passaggio automatico non c'è ancora).
- **Podcast**: rimandati. Quando servono: `read_transcript(slug, from, to)`, la ricerca negli episodi, i verdetti a intervalli di tempo e il badge sulla pagina dell'episodio.

## 11. Rischi

- **Limiti della subscription e dei piani gratuiti**: con 300–400k token in contesto ogni turno pesa. Nella skill il prompt caching aiuta. Nell'app il router gratuito esaurisce le quote giornaliere in fretta (visto il 12/11).
- **Precisione su contesti lunghi**: buona per il triage, meno per i dettagli. Per questo le citazioni letterali si verificano con `grep`.
- **Copyright**: sul sito pubblico vanno solo sintesi e citazioni brevi, mai estratti lunghi.

## 12. Implementazione v1 (12/11)

### Dove vive il codice: `packages/explore` (`@ehub/explore`)

Un pacchetto nuovo, sullo stesso modello di `@ehub/notes`, perché:

- un'esplorazione mette insieme più fonti, quindi non appartiene né a `library` né a `podcasts`;
- `@ehub/chat` resta neutro: non sa nulla di note né di esplorazioni;
- le dipendenze vanno in una sola direzione. `explore` dipende da `library`, `chat` e `ui`; **`library` non importa mai `explore`**. Il badge sulla pagina del libro passa da un segnaposto di `@ehub/ui` (`SourceExtras`) che riempie `apps/web`.

| Parte | Dove |
| ----- | ---- |
| Schema Zod e etichette dei verdetti | `src/schema.ts` (etichette senza Zod in un modulo a parte, per il bundle) |
| File e scritture (atomiche, una alla volta per file) | `src/node/repo.ts`, `src/node/store.ts` |
| CLI `pnpm --silent explore …` | `src/cli/` |
| Server locale `/api/explore` (solo dev) | `src/server/app.ts`, montato da `apps/web/server/explore-dev.ts` |
| Controllo dei file in build | `src/node/vite.ts` (`exploreData()`) |
| Sorgente `exploration` della chat | `src/chat/`, collegata in `apps/web/server/chat-dev.ts` |
| Pagine e badge | `src/web/` |
| Accesso ai libri (testo, sintesi, EPUB solo da esplorare, tool su più libri) | `packages/library/src/node/explore/` (`@ehub/library/explore`) |
| Skill | `.claude/skills/explore/SKILL.md` |

### Il file: `packages/explore/data/<id>.json`

L'ID è la data più lo slug del titolo (`2026-11-12-nietzsche-e-la-morale-cristiana`). Campi:

- `version` (1), `id`, `title`, `question`, `status` (`open` / `closed`), `createdAt`, `updatedAt`;
- `sources[]`: `kind` (`book`), `id`, `origin` (`library` o `explore`), `title`, `authors`, `language`, `epub` (solo per `explore`: nome del file, MD5, dimensione), `addedAt` e `verdict`;
- `verdict`: `null` finché non c'è, altrimenti `decision` (`all` = leggere tutto, `parts` = leggere i capitoli in `chapters`, `skip` = non leggere, `undecided` = da decidere), `reason` (una riga), `decidedAt`, `via` (`skill`, `app` o `cli`);
- `summary`: la sintesi dell'esito, o `null`;
- `notes[]`: `id`, `body`, `book` facoltativo, date e `via`;
- `journal[]`: `at`, `via`, `text`;
- `notebook` (facoltativo, assente = quaderno vuoto): `{ body, updatedAt, via }`, il Markdown condiviso (vedi «Quaderno»).

Titolo e autori dei libri sono copiati nel file, come fanno le note: `/explore` e i badge funzionano sul sito statico senza caricare il catalogo.

### Libri "solo da esplorare"

Un EPUB aggiunto con `--epub` (CLI) o caricato dalla pagina dell'esplorazione:

- va in `~/.cache/e-library/explore/books/<id>/` (EPUB e capitoli in Markdown, stesso formato di `elib text`), mai nel repo; sul Kobo solo con `explore kobo` (§13);
- ha un ID nello stesso formato dei libri della libreria, diverso da tutti quelli esistenti;
- titolo, autori e lingua vengono dai metadati dell'EPUB;
- lo stesso file in due esplorazioni è un solo libro (riconosciuto dall'MD5);
- la cache è l'unica copia: se si svuota, si ricarica lo stesso EPUB e il testo torna, con verdetti e note intatti;
- nella v1 non ha sintesi automatiche (costerebbero 20–30 chiamate sui piani gratuiti) e non ha una pagina sul sito.

### CLI

```
pnpm --silent explore list | show <id> [--json]
pnpm --silent explore new --title T --question Q [--book <id>]… [--epub <file>]…
pnpm --silent explore add <id> (--book <id> | --epub <file>)   |   remove <id> --book <id>
pnpm --silent explore prepare <id> [--budget 500000]
pnpm --silent explore verdict <id> --book <id> --decision all|parts|skip|undecided [--chapters 2,5] --reason R [--via skill]
pnpm --silent explore note <id> (--text T | --text-file F|-) [--book <id>] [--via skill]
pnpm --silent explore journal <id> (--text T | --text-file F|-) [--via skill]
pnpm --silent explore summary <id> (--text T | --text-file F|- | --clear)
pnpm --silent explore notebook <id> (--text T | --text-file F|- | --clear) [--append] [--via skill|app|cli]
pnpm --silent explore close <id> | reopen <id> | validate
```

`prepare` estrae il testo che manca, somma le parole, stima i token (parole × 1,4) e sceglie la strategia: intero sotto la soglia, per capitoli sopra. `--silent` evita le righe di eco di pnpm. I percorsi relativi si risolvono rispetto alla radice del repo: nella skill si usano percorsi assoluti.

### Le due strade sullo stesso file

- **Skill**: avvio o ripresa (`show` per intero, a partire dal diario), `prepare`, lettura dei capitoli dalla cache, citazioni verificate con `grep`, e in chiusura la proposta di verdetti, sintesi e diario che l'utente rivede prima che la CLI li scriva.
- **App** (`pnpm dev`): `/explore` (elenco, anche sul sito pubblicato), `/explore/<id>` (dettaglio, con il Quaderno in sola lettura anche sul sito) e, solo in locale, "Nuova esplorazione", la gestione delle fonti, i verdetti a mano, le note, il Quaderno (modificabile) e la chat. La chat parte da domanda, sintesi dei capitoli, verdetti, note e diario, e legge il testo con `list_chapters`, `read_chapter` e `search_book` (con l'ID del libro). In chiusura chiama `propose_verdicts`, che **non scrive nulla**: la proposta compare come scheda nella chat, e si salva solo con "Conferma e salva".
- **Il diario** è ciò che fa continuare dall'altra parte: la skill lo scrive a ogni fine sessione, l'app lo scrive con la conferma della proposta. Le conversazioni restano dove sono (localStorage nell'app, trascrizione di Claude Code).
- **Badge**: nella pagina di un libro della libreria, "Esplorato in: «titolo» — Leggere i capitoli 2 e 5", con link all'esplorazione. Funziona anche sul sito pubblicato.

### Quaderno (13/11)

Ogni esplorazione ha **un solo documento Markdown condiviso** tra l'utente e Claude: il quaderno, campo `notebook`. È il posto dove stanno appunti lunghi, ragionamenti e risposte che non sono né una nota su un libro né una voce di diario. Le **note separate** restano com'erano: sono brevi, collegabili a un libro, e stanno in `notes[]`.

- **Si scrive da tre parti**: dalla pagina (solo in locale, "Modifica"), dalla chat e dalla skill o dalla CLI.
- **Dalla chat**: "Salva come nota" diventa "Aggiungi al quaderno", che aggiunge la domanda in grassetto e la risposta in fondo. Il tool `save_note` aggiunge allo stesso modo. Per riscrivere tutto il quaderno, il modello usa `propose_notebook`: compare una scheda, e il testo sostituisce il quaderno solo dopo "Sostituisci il quaderno" (oppure si aggiunge in fondo).
- **Dalla skill e dalla CLI**: `pnpm --silent explore notebook <id> --append --via skill` aggiunge in fondo; senza `--append` sostituisce; `--clear` svuota.
- **Pubblicato come il resto**: il quaderno è nel file dell'esplorazione, quindi finisce nel repo e nel sito statico in sola lettura, con la data dell'ultima modifica e chi l'ha scritto (`via`).
- **Limite**: 100.000 caratteri (`MAX_NOTEBOOK_LENGTH`).
- Il quaderno si aggiorna in tempo reale nella pagina accanto alla chat. Mentre lo modifichi a mano, una modifica arrivata dalla chat non sovrascrive il tuo testo: ti avvisa, e salvando sostituisci la versione più recente.

### Prove del 12/11

- **Dalla skill all'app**: un'esplorazione creata con la CLI (`--via skill`, con una voce di diario) si apre su `/explore/<id>`. Nella chat il modello (`gemini-3.5-flash-lite`, declassato a `balanced`, circa 29k token) ha cercato "family" e "boundaries", ha letto il capitolo 16 e ha chiamato `propose_verdicts`. La proposta confermata nell'app ha scritto verdetto, sintesi e diario (`via: app`), e `pnpm explore show` li mostra.
- **Dall'app alla skill**: un'esplorazione creata da "Nuova esplorazione" con due libri, con un verdetto dato a mano nell'app, si continua dalla CLI (verdetto e diario `via: skill`), e l'app li mostra al ricaricamento. Il badge compare nella pagina del libro.
- **EPUB solo da esplorare**: importato dalla CLI nella cache `explore/`, senza toccare la libreria; `prepare` lo legge come gli altri.
- **Quote**: alla prima prova il router aveva tutti gli endpoint in pausa (503 `all_providers_busy`); la chat ha mostrato l'avviso in italiano con il tempo d'attesa, e dopo circa 15 minuti ha funzionato.
- **Corretto durante le prove**: in dev Vite guardava i file di `packages/explore/data` (importati con `import.meta.glob` per la build) e ricaricava la pagina a ogni scrittura, interrompendo il salvataggio della proposta. Ora quella cartella è esclusa dal watcher (`apps/web/vite.config.ts`).
- **Da tenere d'occhio**: il modello ha proposto anche capitoli che non aveva letto (6, 8 e 9), basandosi sui titoli. La scheda di conferma serve proprio a correggere questi casi.

## 13. Esplorazioni sul Kobo (17/11)

Un libro sul Kobo deve essere in libreria: l'argomento è la serie. Quindi **dall'esplorazione al Kobo si passa dalla libreria**.

- **Tag**: ogni esplorazione ha `tags` (minuscoli, al massimo 10, senza virgole). `explore tag <id> --add filosofia`, `--remove`, `--set`; `explore list --tag filosofia`. Il PATCH del server accetta `tags`.
- **`explore kobo --topic <argomento>`** prende i libri _esplorati_ (EPUB nella cache `explore/books/<id>`) delle esplorazioni scelte con `--id` (ripetibile) o `--tag` (ripetibile, basta uno) e li **aggiunge alla libreria con lo stesso ID**, sotto l'argomento indicato (ID o nome, es. `filosofia`). La libreria poi li carica sul Kobo, dove l'argomento è la serie.
  - È lo stesso percorso del form di upload (`analyzeUpload` + `createBook`): metadati e copertina dall'EPUB, KEPUB in cache, `book.json`. Il riassunto fatto per l'esplorazione diventa il `summary.json` del libro e la cartella in `explore/books` sparisce (l'EPUB è nella cache della libreria).
  - Lo stesso ID vuol dire che un libro già caricato sul Kobo come "solo esplorato" non si duplica: il file è lo stesso, si aggiornano nome e serie; i progressi di lettura restano.
  - In ogni esplorazione che lo cita, la fonte diventa «dalla libreria» (senza record EPUB).
  - I libri già in libreria si saltano (ci pensa `elib sync`). `--verdict all|parts|undecided|skip` limita ai libri con quel verdetto; senza, vanno tutti tranne `skip`.
  - `--dry-run` mostra il piano senza scrivere. Il Kobo spento non blocca nulla: i libri entrano in libreria e `elib sync` finisce il lavoro.
  - `--remove` (senza `--topic`) toglie dal Kobo i libri _non ancora_ in libreria, per ripulire i caricamenti fatti prima di questa regola (irreversibile, nessun cestino).
- **Nell'app (solo in dev)**: sull'elenco ogni card ha una casella, c'è il filtro per tag e «Seleziona le visibili»; «Aggiungi alla libreria (N)» apre un dialogo con l'elenco dei libri e la scelta dell'argomento (quelli della libreria; uno nuovo si crea in Libreria → Argomenti). Lo stesso pulsante è nella pagina di un'esplorazione, dove i tag si aggiungono e si tolgono. Endpoint: `POST /api/explore/kobo`, `GET /api/explore/topics`.
- **`elib sync --prune`** non tratta come orfani i libri che hanno ancora una cartella in `explore/books` della cache.
- Codice: `packages/library/src/node/services/explore-promote.ts` (promozione), `packages/explore/src/node/kobo.ts` (selezione e orchestrazione), comando in `packages/explore/src/cli/commands.ts`.

## 14. Ricerca, copertine e sintesi automatica nell’app

- L’elenco usa lo stesso pannello filtri della libreria e dei podcast. La ricerca comprende titolo, domanda, tag e titoli e autori delle fonti. Ogni scheda mostra la copertina del primo libro; per gli EPUB esplorati la copertina viene ricavata dalla cache privata. Si vede in dev e nell’app ospitata con accesso in scrittura. Se la cache o l’immagine manca, si vede un segnaposto.
- In «Nuova esplorazione» si possono scegliere anche uno o più risultati della ricerca Z-Library. Dal dettaglio, il pulsante «Aggiungi una fonte» offre la scelta dalla libreria, da Z-Library o da un EPUB locale. La ricerca usa l’account Z-Library collegato e i suoi limiti di download. Gli EPUB aggiunti da Z-Library seguono il flusso degli EPUB locali e restano nella cache privata. Questi comandi sono disponibili in dev e nell’app ospitata con accesso in scrittura.
- L’app genera una breve sintesi orientativa in background alla creazione e quando cambiano le fonti. Usa la domanda, i metadati e le sintesi dei libri disponibili (in alternativa, gli indici dei capitoli). Salva il risultato in `synthesis`, accanto a `summary`, che continua a raccogliere la sintesi della sessione. Se il modello non risponde, si può riprovare dal dettaglio.
