# e-library — Piano di progetto

Piano ad alto livello, senza codice. Raccoglie **tutte** le decisioni prese nella sessione di definizione del progetto e nella review successiva (9 novembre 2026). Quando una scelta cambia, va aggiornato questo file.

---

## 1. Cos'è

Un gestore **personale** della mia libreria di ebook EPUB, pensato per la lettura su **Kobo**.

- **Un solo utente:** io. Non ci sono account, inviti o multi-tenancy.
- **Consultazione ovunque:** un sito pubblico in sola lettura, comodo anche dal telefono.
- **Modifiche solo in locale:** si aggiunge, modifica ed elimina dal mio PC. Dal telefono non si scrive mai.
- **Conversione automatica** di ogni EPUB in **KEPUB** (`.kepub.epub`), il formato ottimizzato per il Kobo, tramite `kepubify`.
- **Google Drive** contiene i file: sia l'EPUB originale sia il KEPUB.
- **Appunti di lettura:** le sottolineature fatte sul Kobo, una volta rielaborate, vengono agganciate al libro in due livelli (vedi §9).
- **Studio:** una skill dell'agente permette di studiare un libro con l'agente (vedi §11-bis).

### Il ciclo di vita di un libro

1. **Aggiunta** (in locale): carico l'EPUB dal form → l'app estrae i metadati, li correggo, scelgo argomento, tag e copertina → l'app converte in KEPUB, salva la copertina, carica i due file su Drive e scrive per ultimo `book.json` nel repo.
2. **Pubblicazione:** commit e push → la GitHub Action aggiorna il sito.
3. **Lettura:** porto il KEPUB sul Kobo (per ora a mano) e aggiorno lo stato dalla UI locale.
4. **Appunti:** export delle sottolineature → rielaborazione con l'agente → `notes.md` e `recall.md` nella cartella del libro → commit → visibili sul sito.
5. **Studio:** sessione con la skill di studio → `study.md` dopo la mia revisione → commit → visibile sul sito.

## 2. Principi architetturali

| Decisione                        | Scelta                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hosting del sito                 | **GitHub Pages**: statico, pubblico, sola lettura                                                                                  |
| Visibilità                       | **Pubblica**, appunti compresi. Va bene così                                                                                       |
| Backend online                   | **Nessuno**: niente database, niente login, **niente Supabase**                                                                    |
| Backend locale                   | **Server locale** sul mio PC, usato solo per le modifiche                                                                          |
| Fonte di verità dei **metadati** | **Questo repo** (file JSON + Markdown)                                                                                             |
| Fonte di verità dei **file**     | **Google Drive**, che rispecchia il repo. È anche l'unica copia durevole (vedi §14)                                                |
| Operazioni su Drive              | **Riconciliazione ripetibile**: si modifica prima il repo, poi Drive viene allineato con la stessa logica di `elib sync` (vedi §7) |
| EPUB/KEPUB in git                | **Mai**: ci sono copyright, dimensioni e repo pubblico                                                                             |
| Identificativi dei file nel repo | **Nessuno**: niente ID di Drive, percorsi o hash degli EPUB in `book.json` (vedi §5)                                               |
| Link ai file sul sito pubblico   | **Nessuno**, nemmeno link Drive privati                                                                                            |
| AI / LLM nell'app                | **Nessuno**: il lavoro con l'agente (appunti e studio) avviene fuori dall'app, tramite skill dell'agente (vedi §9 e §11-bis)       |

Perché serve un server locale: il browser da solo non può lanciare `kepubify`, chiamare `rclone` o scrivere file nel repo. Il sito su GitHub Pages è un frontend statico e non ha nessun server dietro.

## 3. Stack

- **Un solo pacchetto pnpm**, tutto in **TypeScript**. Il Python è stato scartato per avere un solo linguaggio e un solo schema condiviso. Niente monorepo: per un progetto con un solo autore bastano tre cartelle.
  - `src/shared`: schema Zod e logica isomorfa, usati da tutti;
  - `src/node`: server locale, CLI e la logica che chiama `kepubify` e `rclone`;
  - `src/web`: la SPA.
  - Vincolo: `src/web` non importa mai da `src/node`. Va fatto rispettare con una regola di lint o con la configurazione di TypeScript.
- **Frontend:** SPA **Vite + React + Tailwind CSS + shadcn/ui**.
  - In **build** diventa il sito statico per GitHub Pages, in sola lettura.
  - In **locale** è la stessa UI, con in più i controlli di modifica, che parla con il server locale.
  - **Lettura dei dati:** un **plugin Vite** raccoglie i file di `data/`. In sviluppo serve i dati aggiornati in tempo reale, con watch sui file; in build li scrive come file statici (vedi §4). La lettura funziona allo stesso modo in locale e sul sito: il server Hono serve **solo per le scritture**.
- **Server locale:** **Hono** (Node), che si occupa di upload, conversione, operazioni su Drive e scrittura dei file nel repo.
  - Ascolta **solo su `127.0.0.1`** e rifiuta le richieste con un header `Origin` diverso da quello della UI locale. Qualsiasi sito aperto nel browser può mandare richieste a `localhost`, e questo server può spostare file nel cestino di Drive.
- **CLI** (`elib …`): un altro punto d'ingresso sulla **stessa logica** del server.
- **Schema dati:** uno schema **Zod** condiviso tra frontend, server e CLI, in versione "morbida" (vedi §5).
- **Configurazione:** un file versionato nel repo, `elib.config.json`, con nome del remote rclone, radice su Drive, nomi dei due alberi, sottocartelle per argomento sì/no e percorso della cache. Non contiene segreti: il token resta in `~/.config/rclone/rclone.conf`.
- **Strumenti esterni:**
  - `kepubify`, già installato in `/usr/local/bin/kepubify`, chiamato come sottoprocesso.
  - `rclone`, configurato una volta per Google Drive (vedi Fase 0) e chiamato come sottoprocesso. Scartata la Google Drive API diretta, che avrebbe richiesto di gestire OAuth e token nel codice.
- **Lint/format:** `oxlint` + `oxfmt`, già configurati nel repo. Il gestore pacchetti è pnpm 11.
  - La cartella `data/` è **esclusa da oxfmt** (`ignorePatterns`). Quei file li scrive il server, sempre nello stesso formato: una seconda formattazione sporcherebbe i diff o farebbe fallire `format:check`.
- **Test:** il remote rclone è configurabile, quindi i test di integrazione girano su un **remote rclone locale** (una cartella temporanea) e non toccano Drive. Per le prove manuali si usa una radice separata su Drive, `Libri-test/`.
- **Next.js scartato:** `output: export` non permette API route, e separare admin locale e sito statico sarebbe stato fragile. Questa è una deroga consapevole alla preferenza generale "React + Tailwind + shadcn, con Next.js se serve un backend": qui il backend esiste solo in locale e il sito deve essere statico.
- **Modalità locale e modalità pubblica:** la build per Pages **non include** i controlli di modifica. In locale (dev) la UI li mostra e chiama il server Hono.

## 4. Routing e pubblicazione

- **URL puliti** (`/e-library/book/<id>`), **niente hash router**.
- Per supportarli su GitHub Pages, in build si **copia `index.html` in `404.html`**, così ogni link diretto carica comunque la SPA.
  - Conseguenza nota e accettata: sui link diretti GitHub Pages risponde con lo stato HTTP 404. Il browser non ne risente. Le anteprime dei link (Telegram/WhatsApp) e i motori di ricerca sì.
- Il **base path** è `/e-library/`, da impostare sia in Vite sia nel router, salvo un futuro dominio personalizzato.
- **Deploy:** una **GitHub Action** a ogni push su `main`:
  1. **valida tutti i `book.json` e `topics.json` con lo schema Zod**, perché si possono modificare a mano, e lancia lint, controllo del formato e typecheck. Se qualcosa fallisce, il sito non viene aggiornato;
  2. compila la SPA e genera i dati del sito (vedi sotto);
  3. pubblica su Pages.
- **Dati generati in build**, in due livelli:
  - `index.json`, leggero, con i soli campi delle card: serve a griglia, filtri e ricerca;
  - `books/<id>.json`, uno per libro, con tutti i metadati e con `notes.md`, `recall.md` e `study.md` **già convertiti in HTML**. Così nel bundle non finisce nessun parser Markdown.
- **Flusso di pubblicazione (MVP):** modifico in locale, il server scrive i file nel repo, io faccio **commit e push a mano**, poi parte l'Action.
- Il bottone "Pubblica" nella UI locale (commit + push) è rimandato a dopo (vedi §13).

## 5. Modello dati (repo)

### Struttura

```
elib.config.json             # configurazione (vedi §3)
data/
├── topics.json              # lista controllata degli argomenti
└── books/
    └── <id>/
        ├── book.json        # metadati del libro
        ├── cover.webp       # copertina scelta all'upload (vedi §8)
        ├── notes.md         # futuro: appunti estesi
        ├── recall.md        # futuro: appunti brevi per il recall
        └── study.md         # futuro: esito delle sessioni di studio (vedi §11-bis)
```

- **Un file per libro**, non un unico `library.json` gigante: diff leggibili, niente conflitti, appunti accanto al loro libro.
- In **build** i `book.json` diventano i file del sito descritti in §4.
- La **cache locale** (EPUB, KEPUB, testo estratto, export grezzo delle sottolineature) sta **fuori dal repo**, di default in `~/.cache/e-library`, con percorso configurabile. Dentro il repo un `git clean -fdx` la cancellerebbe, e il testo dei libri non deve mai trovarsi nella cartella di un repo pubblico.

### Identità

- Ogni libro ha un **ID stabile e immutabile** di **8 caratteri base32 casuali** (alfabeto Crockford, minuscolo). È usato come nome della cartella, nell'URL e nel nome dei file su Drive (vedi §6). L'unicità si verifica sulle cartelle già presenti in `data/books/`.
- Titolo e autore sono **solo metadati**: correggerli non rompe link, percorsi o la cronologia di git.
- Nell'URL si può aggiungere uno **slug leggibile**, tipo `kahneman-thinking-fast-and-slow`, solo per comodità.

### `book.json`: JSON "morbido"

- **Campi obbligatori:** `id`, `title`, `authors`, `topic`, `status`.
- **Campi opzionali:** `tags`, data di inizio e fine lettura, voto, `isbn`, `openLibraryCoverId`, editore, lingua, descrizione, soggetti originali dell'EPUB.
- **Nessun identificativo dei file:** niente ID di Drive, percorsi o hash.
  - Un ID di Drive equivale al link al file, che §2 esclude.
  - Un hash identificherebbe pubblicamente quel preciso file EPUB, e chiunque potrebbe confrontarlo con cataloghi esterni.
  - Non servono: il percorso su Drive si ricava da configurazione, argomento, autore, titolo e ID (vedi §6), e i duplicati si cercano su Drive (vedi §7).
- **I campi sconosciuti si conservano sempre:** se aggiungo qualcosa a mano, l'app non lo cancella mai.
- **I nomi dei campi e i valori enum sono in inglese.** Le etichette nella UI sono in italiano.

### Classificazione

- **Argomento:** **uno solo** per libro, preso da una **lista controllata** (`topics.json`) **modificabile dalla UI locale**. È controllata perché l'argomento determina la cartella su Drive, e un refuso creerebbe una cartella nuova.
  - Ogni argomento ha un **ID stabile** e un'**etichetta** in italiano, per esempio `{ "id": "unsorted", "label": "Da smistare" }`. L'ID si ricava dall'etichetta alla creazione e poi non cambia più. In `book.json` si salva l'ID, quindi rinominare un argomento non riscrive i libri.
  - La lista contiene sempre l'argomento speciale **`unsorted` ("Da smistare")**, usato per i libri importati in blocco e non ancora classificati. Non si può eliminare.
  - L'argomento è il criterio di **gerarchia** su Drive: le "sezioni" della libreria sono gli argomenti, e le cartelle usano l'etichetta.
- **Tag:** **liberi**, più d'uno per libro, con autocompletamento sui tag già usati.
- **Stato:** `to-read` / `reading` / `read` / `abandoned`, mostrati come _da leggere / in lettura / letto / abbandonato_.
- **Metadati iniziali:** estratti in automatico dall'EPUB (titolo, autore, soggetti, ISBN, copertina…) e poi corretti a mano.

## 6. Google Drive

### Struttura

Due alberi separati sotto la stessa cartella radice `Libri/`:

```
Libri/
├── Rakuten Kobo/<Argomento>/<Autore> - <Titolo> [<id>].kepub.epub   # solo KEPUB: la cartella che legge il Kobo
└── Archivio/<Argomento>/<Autore> - <Titolo> [<id>].epub             # solo EPUB originali: il Kobo non la vede
```

- Gli alberi sono **separati** perché l'integrazione Google Drive del Kobo sincronizza **tutto** il contenuto della cartella `Rakuten Kobo`. Con EPUB e KEPUB nella stessa cartella li scaricherebbe tutti e due.
- **Tutti i libri** finiscono nella cartella Kobo, compresi quelli già letti. Un filtro per stato è rimandato a dopo, anche per non rischiare di perdere sul dispositivo sottolineature non ancora esportate.
- **Tutti i percorsi sono configurabili:** radice, nome delle due cartelle e presenza o meno della sottocartella argomento. Se i test del Kobo vanno male (vedi §12), si cambia la configurazione senza riscrivere codice.
- **Remote ristretto:** l'app usa un remote rclone `elib` con `root_folder_id` impostato sulla cartella `Libri/`. Così un errore nel calcolo dei percorsi non può toccare il resto del Drive (`__GGabry`, `Google AI Studio`…). Se il test 1 della Fase 0 fallisce e `Rakuten Kobo` deve restare nella radice, servono due remote ristretti, uno per albero.
- Le **operazioni su Drive** passano tutte da `rclone`: copia, spostamento ed eliminazione.
- Le **eliminazioni** finiscono nel **cestino di Drive**, che è il comportamento predefinito di rclone. Si possono recuperare **per 30 giorni**, poi Drive le cancella da solo.

### Nomi dei file

- **Formato:** `<Autore> - <Titolo> [<id>]`, con estensione `.epub` per l'originale e `.kepub.epub` per il KEPUB (l'estensione che il Kobo riconosce).
- **L'ID nel nome** serve a tre cose:
  - rende ogni nome univoco. Drive accetta più file con lo stesso nome nella stessa cartella e rclone gestisce male i doppioni, mentre due edizioni o traduzioni dello stesso libro avrebbero stesso autore e stesso titolo;
  - permette a `elib sync` di riconoscere un file finito nel posto sbagliato, anche dopo una modifica a mano di `book.json`;
  - aggancia le sottolineature esportate al libro giusto (vedi §9).

  Sul Kobo il suffisso non si vede, perché il Kobo mostra il titolo preso dai metadati.

- **Pulizia del nome:**
  - si usa solo il primo autore;
  - i caratteri non ammessi da FAT32, il file system della memoria del Kobo (`: ? " * < > | \ /`), vengono sostituiti. Senza questa pulizia "Sapiens: Da animali a dèi" non si copierebbe sul Kobo via USB;
  - il nome viene troncato a una lunghezza massima.

  Le regole, fissate in Fase 1 (`src/shared/naming.ts`), valgono per autore, titolo ed etichetta dell'argomento. Esempio: `Yuval Noah Harari - Sapiens - Da animali a dèi [7k2m9q4t].kepub.epub`.
  - il testo passa in Unicode NFC; ogni sequenza di spazi, tabulazioni o a capo diventa un solo spazio; i caratteri di controllo e quelli invisibili (trattino morbido, spazi a larghezza zero, controlli bidirezionali) vengono tolti;
  - `:` `|` `/` `\` fanno da separatori: diventano un trattino tra due spazi se hanno uno spazio accanto ("Sapiens: Da animali a dèi" → "Sapiens - Da animali a dèi"), un trattino semplice se stanno tra due parole ("AC/DC" → "AC-DC");
  - `"` diventa `'`; `?` `*` `<` `>` vengono tolti;
  - si eliminano spazi doppi, separatori ripetuti e spazi o trattini all'inizio e alla fine. Il nome non comincia mai con un punto, perché il Kobo nasconde quei file;
  - **lunghezza:** l'autore si tronca a 60 caratteri, poi `<Autore> - <Titolo>` a **120 caratteri** e comunque a 200 byte in UTF-8, all'ultimo spazio se cade nella seconda metà, senza punteggiatura appesa in fondo. Con ` [<id>].kepub.epub` il nome resta entro 142 caratteri: sotto il limite di FAT32 (255) e di ext4 (255 byte), e abbastanza corto per i percorsi di Windows (260 caratteri) quando si copia sul Kobo via USB. Sul Kobo il taglio non si vede, perché mostra il titolo dei metadati;
  - le **cartelle degli argomenti** usano la stessa pulizia, con un massimo di 60 caratteri e senza punti o spazi finali. I nomi riservati di Windows (`CON`, `NUL`…) prendono un `_` in fondo. Due argomenti non possono finire nella stessa cartella: lo schema di `topics.json` lo rifiuta, confrontando i nomi senza distinguere maiuscole e minuscole, come FAT32.

### Stato di partenza

Su Drive ci sono già diversi EPUB in una struttura che non rispecchia questa. Verranno scaricati e reimportati (Fase 5). La vecchia struttura **non si svuota**: si sposta in `Libri/_vecchio` e si cancella solo dopo aver verificato l'import.

### Kobo

- Fatto verificato (guida ufficiale Kobo): la cartella `Rakuten Kobo` viene **creata automaticamente nella radice di Drive** quando colleghi l'account Kobo, e il Kobo legge **solo** i file al suo interno. Ad ogni sincronizzazione scarica i file nuovi in _I miei libri_.
- Il mio Kobo **ha** l'integrazione Google Drive e la userò. **Per ora però i libri li porto sul Kobo a mano**, per andare sul sicuro.
- La struttura sopra è comunque già pronta per quando attiverò la sincronizzazione.
- **Cartella Kobo piatta se le sottocartelle non servono:** se i test della Fase 0 mostrano che il Kobo non legge le sottocartelle, o non le trasforma in collezioni, ordinare per argomento la cartella `Rakuten Kobo` non porta vantaggi sul dispositivo e moltiplica gli spostamenti. In quel caso il default diventa una cartella Kobo piatta, con gli argomenti solo in `Archivio/`.
- **Passaggio da USB a sincronizzazione Drive:** quando attiverò la sincronizzazione, i libri già copiati a mano arriverebbero una seconda volta, mentre le loro sottolineature restano sulla copia USB. Prima del passaggio vanno esportate le sottolineature e va deciso cosa fare delle copie USB.

## 7. Funzioni della UI locale (admin)

1. **Upload**
   - Si trascina un EPUB e si apre un form **precompilato** con i metadati estratti: titolo, autore, soggetti, ISBN.
   - **Copertina:** il form mostra affiancate la copertina estratta dall'EPUB e quella trovata su Open Library, e scelgo io (vedi §8).
   - Correggo i campi, scelgo argomento e tag, confermo.
   - Il server allora, in quest'ordine:
     - converte con kepubify e mette EPUB e KEPUB nella cache locale;
     - salva la copertina scelta come `cover.webp`;
     - carica EPUB e KEPUB nei due alberi di Drive con rclone;
     - scrive **per ultimo** `book.json`: se un passo precedente fallisce, nel repo non resta un libro a metà.
2. **Controllo duplicati** all'upload: per **MD5 del file**, confrontato con quelli dell'Archivio tramite `rclone md5sum`. Drive conserva l'MD5 di ogni file, quindi non serve scaricare niente né salvare hash nel repo. In più c'è un **avviso** se titolo e autore coincidono con un libro esistente.
3. **Modifica dei metadati**, copertina compresa. Se cambiano argomento, titolo o autore cambia anche il percorso su Drive, e la riconciliazione sposta i file in entrambi gli alberi.
4. **Modifica di più libri insieme:** seleziono più libri e assegno argomento, tag o stato in un colpo solo. Serve soprattutto dopo la Fase 5, con decine di libri "Da smistare".
5. **Eliminazione:** i file del libro vanno nel cestino di Drive e il libro viene tolto dal repo. È l'unica operazione che cancella esplicitamente su Drive. La copia nella cache locale resta, come ultima copia finché il cestino di Drive la conserva.
6. **Gestione degli argomenti:** aggiungere, rinominare ed eliminare voci di `topics.json` dalla UI.
   - **Rinominare** un argomento cambia solo l'etichetta in `topics.json`: i libri salvano l'ID e restano invariati. Le cartelle su Drive, che usano l'etichetta, vengono rinominate in entrambi gli alberi.
   - **Eliminare** un argomento che ha ancora libri li riassegna a "Da smistare", dopo una conferma che dice quanti sono.

**Riconciliazione.** Tutte le operazioni seguono lo stesso schema: modificano il repo e poi chiamano `reconcile(id)`, cioè la logica di `elib sync` (§11) limitata a un libro. Non esistono logiche di spostamento separate per ogni operazione. Così ogni operazione si può ripetere, e dopo un errore a metà basta rilanciare `elib sync`: per esempio se l'EPUB è stato caricato e il KEPUB no, o se una rinomina di argomento si è fermata dopo 12 libri su 30. Fanno eccezione l'upload, che scrive `book.json` per ultimo (punto 1), e l'eliminazione, che mette i file nel cestino in modo esplicito.

Tutte le operazioni scrivono solo file nel repo e su Drive: **non fanno commit**. La pubblicazione resta un passo manuale (§4).

## 8. Copertine

- **La copertina si sceglie all'upload e si salva sempre nel repo** come `cover.webp`: ridimensionata a circa 600px di larghezza e convertita in **WebP** (30–60 KB). Per 500 libri sono circa 25 MB, e il sito non dipende da servizi esterni.
- **Le candidate**, mostrate affiancate nel form:
  1. **la copertina estratta dall'EPUB**, che corrisponde sempre all'edizione che possiedo;
  2. **la copertina di Open Library.** Il server cerca il libro per **ISBN** (o per titolo e autore se manca l'ISBN), salva nel JSON `isbn` e `openLibraryCoverId` e scarica l'immagine da `covers.openlibrary.org/b/id/<cover_id>-L.jpg`. Un abbinamento trovato per titolo e autore va sempre **confermato a mano**: Open Library copre poco le edizioni italiane e spesso restituisce un'altra edizione.
- **Segnaposto generato** con titolo e autore, se nessuna immagine è disponibile.
- **Import in blocco (Fase 5):** si usa la copertina dell'EPUB, e la si può cambiare dopo dalla UI. Le ricerche per ISBN su Open Library vanno rallentate: sono limitate a 100 richieste ogni 5 minuti per IP.

Open Library è gestito dall'Internet Archive e nell'ottobre 2024 è rimasto giù per settimane. Ora lo si usa solo all'upload: un disservizio toglie una delle due candidate, ma non tocca il sito.

## 9. Appunti e sottolineature

Il flusso previsto:

1. **Leggo sul Kobo** e sottolineo.
2. Le sottolineature vengono **esportate** dal Kobo. Il **formato e il metodo di export sono da definire** (vedi §13). L'ipotesi di ripiego è leggere `.kobo/KoboReader.sqlite` dal Kobo collegato via USB, perché con i KEPUB le evidenziazioni vengono registrate meglio.
   - Per i libri copiati via USB il database del Kobo identifica il libro dal percorso del file. Grazie all'ID nel nome (§6), agganciare l'export al libro giusto è immediato.
   - **L'export grezzo non è mai pubblico:** resta nella cache locale, fuori dal repo. Pubblicare in blocco citazioni letterali andrebbe oltre la citazione breve consentita.
3. Passo l'export a un **agente esterno all'app** e lo rielaboro in conversazione con l'agente. **L'app non ha nessun ruolo in questa fase.**
4. Il risultato si aggancia al libro in **due livelli**, entrambi **rielaborati**, con solo citazioni brevi:
   - **`notes.md`**: appunti **estesi**;
   - **`recall.md`**: appunti **brevi**, per il memory recall.
5. Il sito pubblico mostra entrambi i file, convertiti da Markdown a HTML in build, nella pagina del libro. **Gli appunti sono pubblici.**

Per ora l'app si limita a **mostrare** questi file. Il "contratto" con l'agente sono solo i file Markdown nella cartella del libro.

## 10. Sito pubblico (sola lettura)

- **Griglia di copertine** grandi.
- **Filtri** per argomento, tag e stato.
- **Ricerca** su titolo e autore, fatta **interamente nel browser** su `index.json`.
- **Pagina del libro** con metadati, copertina, `notes.md`, `recall.md` e `study.md`, caricati da `books/<id>.json`.
- **Nessun link ai file** e nessun download.
- **Lingua:** interfaccia in **italiano**.
- **Stile:** deve essere **piacevole da vedere**. Copertine protagoniste, **serif per i titoli**, tipografia curata, **tema chiaro e scuro**, componenti shadcn come base.

## 11. CLI

Sono comandi sulla stessa logica del server locale:

- **`elib sync`**: avvia la sincronizzazione. La direzione è **repo → Drive**: fa in modo che Drive rispecchi il repo.
  - Carica i file mancanti dalla cache locale.
  - Sposta quelli fuori posto, riconosciuti dall'ID nel nome (§6).
  - **Segnala** quelli orfani senza cancellarli. Solo con un `--prune` esplicito li mette nel cestino.
  - `--prune` ha un limite di sicurezza: viene rifiutato se il repo non ha libri o se i file da cestinare sono troppi (più di 10, o almeno il 20% dei file riconosciuti), salvo `--force`. Il resoconto mostra sempre la cartella dati letta e quanti libri contiene.
  - Ha un `--dry-run`. Si lancia a mano.
  - È la stessa logica che la UI usa per un singolo libro (`reconcile(id)`, vedi §7).
- **`elib import <cartella>`**: importazione in blocco per la migrazione iniziale (vedi §12). Ha un `--dry-run`, che si scrive già in Fase 2 per provare l'estrazione dei metadati sugli EPUB veri.
- **`elib text <id>`** (Fase 6): estrae il testo del libro in **Markdown diviso per capitoli**. Prende l'EPUB dalla cache locale, oppure lo scarica da Drive con rclone. Il risultato va nella cache locale, fuori dal repo (§5): **il testo dei libri non entra mai nel repo pubblico**.

## 11-bis. Skill di studio

Una skill dell'agente per **studiare un libro insieme all'agente**. Come per gli appunti, vive **fuori dall'app**: l'app non chiama nessun LLM.

- **Dove vive:** in questo repo, in `.claude/skills/study/`, versionata insieme al progetto.
- **Accesso al testo:**
  - **Base:** l'agente legge i capitoli che servono, prodotti da `elib text <id>`, e cerca con `grep` nei file Markdown dei capitoli. Un libro intero sono spesso 100–200k token, quindi non si carica tutto a ogni sessione. La cache sta fuori dal repo, quindi la sua cartella va aggiunta a quelle che l'agente può leggere.
  - **RAG al volo:** un indice costruito sul momento sul testo estratto, per fare domande su tutto il libro senza scegliere i capitoli. Si valuta **solo se `grep` non basta**. Scelte aperte: modello di embedding (locale o API) e dove tenere l'indice (sempre in cache, fuori da git).
- **Modalità**, scelte **all'avvio** della sessione insieme a libro e capitoli:
  - **Socratica** (predefinita): l'agente fa domande per farmi arrivare ai concetti da solo;
  - **Quiz**: domande sul capitolo, con correzione;
  - **Spiegazione**: chiarimento di passaggi, con riferimenti al testo.
- **Cosa resta:** a fine sessione l'agente propone cosa salvare (concetti chiave, domande sbagliate, punti da ripassare). **Lo rivedo io** prima che venga scritto in `study.md` nella cartella del libro. Il file è **pubblicato sul sito pubblico** nella pagina del libro.
- **`study.md` resta separato da `recall.md`:** lo produce un processo diverso, con un ciclo di vita diverso.

## 12. Fasi di lavoro

### Fase 0: prerequisiti (manuali)

- **Creare un client OAuth personale per rclone. È urgente e va fatto per primo.** Il remote `gdrive` usa ancora il client ID condiviso di rclone, che secondo la [guida rclone](https://rclone.org/drive/#making-your-own-client-id) "will stop working during 2026". Siamo a novembre: può smettere di funzionare da un giorno all'altro. La procedura, da fare io nella Google Cloud Console:
  1. creare un progetto e abilitare la Google Drive API;
  2. configurare la schermata di consenso OAuth come "Esterno", con me come utente di test;
  3. creare credenziali di tipo "App desktop";
  4. **pubblicare l'app** ("Publish app" nella sezione "Audience"). In stato "Testing" Google fa scadere l'autorizzazione dopo 7 giorni. Al login compare la schermata "app non verificata", da accettare: si vede solo durante `rclone config`;
  5. ripetere l'autenticazione di `gdrive` con client ID e secret, inseriti direttamente nel terminale e mai in chat o nel repo.
- Installare e configurare **rclone** con Google Drive. ✅ Fatto il 9 novembre 2026: remote `gdrive`, accesso a tutto il Drive (`scope=drive`).
- Creare la cartella `Libri/` e il **remote ristretto `elib`**, con `root_folder_id` puntato su di essa (vedi §6).
- **Test sul Kobo**, da fare **prima** di scrivere il codice che tocca Drive:
  1. Spostare la cartella `Rakuten Kobo` sotto `Libri/` e verificare che il Kobo la sincronizzi ancora.
  2. Verificare se il Kobo legge le **sottocartelle** di `Rakuten Kobo` e se le trasforma in collezioni. Se no, la configurazione passa a una cartella Kobo piatta (vedi §6).
  3. **Spostare o rinominare un file già sincronizzato** e verificare se il Kobo lo tratta come un libro nuovo, perdendo progressi e sottolineature. È il test più importante: ogni cambio di argomento o correzione del titolo sposta il file, e la Fase 5 li sposta _tutti_ fuori da "Da smistare". Se il Kobo perde i dati, la struttura della cartella Kobo va ripensata prima di attivare la sincronizzazione.
  4. Verificare se un `.kepub.epub` scaricato da Drive viene aperto come KEPUB o come EPUB normale.
- Creare il repo GitHub **pubblico** e abilitare GitHub Pages tramite Actions.
- **Prima del primo commit:** impostare in questo repo (`git config user.email`, solo a livello locale) l'indirizzo noreply di GitHub. Nel repo pubblico ogni commit mostra l'email dell'autore.

### Fase 1: scaffolding

- Pacchetto pnpm unico con `src/shared`, `src/node` e `src/web`, e la regola che impedisce a `src/web` di importare da `src/node`.
- Schema Zod "morbido", struttura `data/`, `topics.json` iniziale con ID ed etichette.
- `elib.config.json`: remote rclone, percorsi di Drive (radice, alberi, sottocartelle), percorso della cache.
- Regole per i nomi dei file su Drive: caratteri sostituiti e lunghezza massima (vedi §6).
- Esclusione di `data/` da oxfmt.
- Base per i test: remote rclone locale su una cartella temporanea.

### Fase 2: logica di base (server + CLI)

- **Prima di tutto, una fetta verticale:** un libro dall'EPUB fino al sito pubblicato (estrazione dei metadati → `book.json` → sito minimo → deploy). Serve a validare subito CLI, schema, build e deploy, prima di completare il resto della fase.
- **Presto, `elib import --dry-run` sugli EPUB veri**, usando una copia scaricata da Drive senza toccare l'originale. Mostra quanto funziona l'estrazione dei metadati.
- Lettura dei metadati e della copertina dall'EPUB.
- Conversione con kepubify.
- Ricerca su Open Library (ISBN o titolo/autore → cover ID) e download della copertina.
- Operazioni su Drive con rclone (copia, spostamento, cestino).
- `reconcile(id)` ed `elib sync`, sulla stessa logica.
- Lettura e scrittura di `book.json` con conservazione dei campi sconosciuti.
- Controllo duplicati per MD5 con `rclone md5sum`.

### Fase 3: UI locale (admin)

- Upload con form precompilato e scelta della copertina, modifica, modifica di più libri insieme, eliminazione, gestione degli argomenti.
- Server in ascolto solo su `127.0.0.1`, con controllo dell'header `Origin`.

### Fase 4: sito pubblico e deploy

- Griglia, filtri, ricerca, pagina del libro con resa degli appunti.
- Plugin Vite per i dati: `index.json` e `books/<id>.json`, con il Markdown già convertito in HTML. Base path, `404.html`.
- GitHub Action su push a `main`: validazione Zod dei dati, lint, controllo del formato e typecheck, poi deploy.

### Fase 5: migrazione iniziale (più avanti)

- Scarico tutti gli EPUB attuali da Drive, **sposto** la vecchia struttura in `Libri/_vecchio` e reimporto tutto in blocco con `elib import`. La vecchia struttura si cancella solo dopo aver verificato l'import.
- I libri importati hanno argomento **"Da smistare"** finché non li classifico dalla UI, anche con la modifica di più libri insieme.
- Copertine prese dall'EPUB, ricerche per ISBN su Open Library rallentate (vedi §8).

### Fase 6: skill di studio (dopo il sito pubblico)

- `elib text <id>`: estrazione del testo in Markdown per capitolo, nella cache fuori dal repo.
- La skill `.claude/skills/study/` con le tre modalità (socratica predefinita, quiz, spiegazione) scelte all'avvio.
- Scrittura di `study.md` dopo la mia revisione, e sua visualizzazione nella pagina del libro.
- Ricerca nei capitoli con `grep`. La RAG al volo si valuta solo se `grep` non basta.

## 13. Rimandato a dopo

- **Export delle sottolineature dal Kobo:** formato, metodo e parser.
- **Formato di `notes.md` e `recall.md`:** per esempio se il recall diventa flashcard o un riassunto.
- **Migrazione in blocco** dei libri attuali (Fase 5).
- **Sincronizzazione automatica Kobo ↔ Drive** tramite l'integrazione nativa. Per ora si fa a mano (vedi il passaggio da USB in §6).
- **Bottone "Pubblica"** nella UI locale (commit + push).
- **Filtro per stato** nella cartella Kobo (solo `to-read`/`reading` sul dispositivo).
- **Funzioni AI dentro l'app** (ricerca semantica, chat con il libro, auto-tagging): non previste. Il lavoro con l'agente resta fuori dall'app, tramite skill. Lo studio con l'agente è nella Fase 6.

## 14. Rischi e vincoli noti

- **Kobo:** non ho trovato conferma ufficiale che legga le sottocartelle, che la cartella `Rakuten Kobo` si possa spostare o che conservi progressi e sottolineature quando un file viene spostato o rinominato. Si mitiga con i test della Fase 0 e i percorsi configurabili.
- **Open Library:** possibili disservizi e limiti di frequenza. Lo si usa solo all'upload, per proporre una copertina: un disservizio non tocca il sito.
- **`404.html`:** i link diretti rispondono con stato HTTP 404. È accettato.
- **Repo pubblico:** non devono mai entrarci EPUB, KEPUB, il **testo estratto** dei libri, gli indici della RAG, l'**export grezzo** delle sottolineature, ID di Drive o hash dei file. Le copertine, gli appunti rielaborati e `study.md` pubblici sono accettati.
- **GitHub Pages è sempre pubblico**, anche con repo privato (salvo il piano Enterprise): chiunque abbia l'URL vede lista dei libri, stati e appunti. È accettato.
- **Client OAuth condiviso di rclone in ritiro:** finché non creo un client personale (Fase 0, urgente), l'accesso a Drive può smettere di funzionare da un giorno all'altro.
- **Drive è l'unica copia durevole degli EPUB**, e il suo cestino si svuota da solo dopo 30 giorni. Mitigazioni:
  - cache locale fuori dal repo;
  - remote rclone ristretto a `Libri/`;
  - nessuna cancellazione implicita in `elib sync`;
  - vecchia struttura conservata in `Libri/_vecchio` finché l'import della Fase 5 non è verificato.
- **Cache locale:** se viene cancellata, i file si riscaricano da Drive con rclone.
- **Server locale raggiungibile dai siti aperti nel browser:** si mitiga con l'ascolto solo su `127.0.0.1` e il controllo dell'header `Origin`.

## 15. Alternative valutate e scartate

| Tema                    | Alternativa scartata                                                                      | Perché                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo di prodotto        | Catalogo/prestito di biblioteca; tracker stile Goodreads senza file                       | Serve un gestore personale dei miei EPUB                                                                                                                                                        |
| Database                | **Supabase/Postgres** (collegabile a Pages con `supabase-js`, Auth e RLS)                 | Due fonti di verità da tenere allineate, login e policy da gestire; inutile visto che dal telefono non si scrive                                                                                |
| Privacy del sito        | Vercel/Cloudflare Pages + Cloudflare Access, oppure app locale via Tailscale              | Il sito pubblico va bene                                                                                                                                                                        |
| Scrittura da remoto     | Modifiche dal telefono                                                                    | Basta consultare; si modifica solo in locale                                                                                                                                                    |
| Accesso a Drive         | Google Drive API diretta                                                                  | OAuth e token da gestire nel codice; rclone fa tutto con una configurazione una tantum                                                                                                          |
| Accesso a Drive         | Drive montato in locale (rclone mount, GNOME Online Accounts)                             | Più fragile, e serve comunque scrivere in punti precisi                                                                                                                                         |
| Sincronizzazione        | `rclone bisync` bidirezionale con una cartella locale (prima proposta)                    | Superata dalla scelta "il repo è la verità": la direzione è repo → Drive                                                                                                                        |
| Operazioni su Drive     | Una logica di spostamento separata per ogni operazione                                    | Un errore a metà lascia stati incoerenti; meglio una sola riconciliazione ripetibile                                                                                                            |
| Fonte di verità         | Drive (una cartella per libro con `meta.md`) o un database                                | Ho deciso che la verità vive nel repo                                                                                                                                                           |
| Backend                 | Next.js; Python/FastAPI                                                                   | Next.js non convive con `output: export`; Python avrebbe richiesto di duplicare lo schema                                                                                                       |
| Struttura del codice    | Monorepo pnpm (SPA, server, pacchetto condiviso)                                          | Per un progetto con un solo autore basta un pacchetto con tre cartelle                                                                                                                          |
| Dati                    | Un unico `library.json`                                                                   | Diff illeggibili e conflitti; un file per libro è più pulito                                                                                                                                    |
| Identificativi dei file | ID di Drive, percorsi e hash in `book.json`                                               | L'ID di Drive equivale al link al file; l'hash identifica pubblicamente il file; il percorso si ricava                                                                                          |
| Nomi dei file           | `<Autore> - <Titolo>` senza ID                                                            | Nomi non univoci; `elib sync` non saprebbe abbinare file e libri                                                                                                                                |
| Argomenti               | Testo libero                                                                              | I refusi creerebbero cartelle su Drive                                                                                                                                                          |
| Argomenti               | Etichetta salvata direttamente in `book.json`                                             | Rinominare un argomento avrebbe riscritto tutti i suoi libri                                                                                                                                    |
| Routing                 | Hash router (`/#/book/<id>`)                                                              | Preferiti URL puliti con il trucco del `404.html`                                                                                                                                               |
| Routing                 | Una pagina HTML generata in build per ogni libro (stato 200, anteprime dei link corrette) | Proposta nella review del 9 novembre 2026 e non adottata: resta il `404.html`                                                                                                                   |
| Link ai file            | Link Drive non condivisi (aprono il file solo a me)                                       | Il sito non deve avere link ai file                                                                                                                                                             |
| Copertine               | Caricamento a runtime da Open Library, per ISBN o per cover ID                            | Per ISBN si supera il limite di frequenza; in ogni caso resta una dipendenza esterna, e Open Library spesso trova un'altra edizione. Ora la copertina si sceglie all'upload e si salva nel repo |
| Cache locale            | Cartella nel `.gitignore` dentro il repo                                                  | `git clean -fdx` la cancella, e il testo dei libri non deve stare nella cartella del repo                                                                                                       |
| Migrazione              | Svuotare subito la vecchia struttura su Drive                                             | Si sposta in `Libri/_vecchio` finché l'import non è verificato                                                                                                                                  |
| Cartella Kobo           | Solo libri `to-read`/`reading`                                                            | Rimandato: rischio di perdere sottolineature non esportate                                                                                                                                      |
| Conversione             | Calibre (`ebook-convert`, installato)                                                     | kepubify è lo strumento specifico per KEPUB                                                                                                                                                     |
| AI nell'app             | Ricerca semantica, chat con il libro, auto-tagging nell'app                               | Il lavoro con l'agente resta fuori dall'app, tramite skill                                                                                                                                      |

## 16. Stato attuale dell'ambiente (9 novembre 2026)

> Aggiornamento del 10 novembre 2026: il codice delle Fasi 1–4 e 6 (più `elib import`) è implementato. Lo stato del lavoro, le decisioni prese e i passi rimasti sono in `docs/PROGRESS.md`. L'elenco qui sotto descrive l'ambiente prima dell'implementazione.

- **Repo:** branch `main` senza commit. Contiene solo `package.json` (script `lint`, `lint:fix`, `format`, `format:check`), `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore` (già ignora `node_modules`, `dist`, `.env*`), `pnpm-lock.yaml` e questo piano.
- **kepubify:** installato in `/usr/local/bin/kepubify`.
- **Calibre:** installato (`ebook-convert`), non usato.
- **rclone:** v1.76, installato con Homebrew. Remote **`gdrive`** configurato con `scope=drive`, con il token in `~/.config/rclone/rclone.conf` (fuori dal repo). Usa ancora il **client ID condiviso** di rclone, in ritiro (vedi Fase 0).
- **Google Drive:** 100 GiB, circa 18 GiB usati. **Non montato** in locale; vi si accede solo tramite rclone. Nella radice ci sono `Google AI Studio` e `__GGabry`. **Non c'è ancora una cartella `Rakuten Kobo`**: l'integrazione Kobo forse non è collegata, o la cartella sta altrove. Non so ancora dove si trovino gli EPUB attuali.
- **Python e uv:** disponibili, ma il progetto è tutto in TypeScript.

## 17. Punti aperti e interpretazioni da confermare

Decisioni non ancora prese, o scritte in questo piano senza una conferma esplicita:

- **Esiti dei test sul Kobo** (Fase 0): cartella `Rakuten Kobo` spostabile sotto `Libri/`? Sottocartelle lette e trasformate in collezioni? Progressi e sottolineature conservati dopo uno spostamento? KEPUB riconosciuti?
- **Dove sono oggi gli EPUB su Drive**, e perché nella radice non c'è la cartella `Rakuten Kobo`.
- **Export delle sottolineature:** formato e metodo. È già deciso che l'export grezzo resta fuori dal repo.
- **Formato di `notes.md`, `recall.md` e `study.md`.**
- **RAG al volo:** se serve davvero, cioè se `grep` sui capitoli non basta; con quale modello di embedding (locale o API) e dove tenere l'indice.
- **Voto:** previsto come campo opzionale, ma non è mai stato deciso se mostrarlo o usarlo.
- **Dominio personalizzato:** se in futuro si usa, il base path `/e-library/` cambia.
