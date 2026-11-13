# Chat con l'AI — Piano

Piano di implementazione. Raccoglie le decisioni prese nella sessione del 12 novembre 2026. Quando una scelta cambia, va aggiornato questo file.

> **Cambia una decisione di [esplorazioni.md](esplorazioni.md) §2** ("AI dentro l'app: nessuna"). Da qui in poi l'app ha una chat, ma solo in locale. Quando questo piano parte, va aggiornato anche quel file.

---

## 1. Cos'è

Una chat dentro l'app, aperta dalla pagina di una fonte, che parla con un endpoint **OpenAI-compatibile**:

| Dove si apre       | Cosa sa l'agente fin dall'inizio                                | Cosa può fare con i tool                                       |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------- |
| **Libro**          | Metadati, sintesi del libro, **sintesi di ogni capitolo**       | Leggere i capitoli che sceglie, cercare nel testo               |
| **Episodio**       | Metadati, sintesi, **trascrizione intera** con minuti e speaker | Nessuno nella v1 (tutto è già nel contesto)                    |
| **Esplorazione**   | La domanda, le sintesi di tutti i libri, verdetti, note e diario | Leggere i capitoli, cercare in uno o in tutti i libri, proporre i verdetti (v1 solo libri) |

## 2. Decisioni

| Decisione            | Scelta                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Dove gira            | **Solo in locale** (`pnpm dev`). Server Hono dev-only, come note e podcast. Nessuna chiave nel sito statico         |
| Endpoint             | OpenAI-compatibile (`/v1/chat/completions`, streaming, tool calling). Configurato in `.env.local` (gitignored)       |
| Libreria LLM         | **AI SDK di Vercel** (`ai` v7 + `@ai-sdk/openai-compatible`, `@ai-sdk/react` per l'interfaccia)                     |
| Finestra di contesto | Tier `smart` a **contesto lungo**: budget di default 1M token, configurabile (`EHUB_AI_MAX_CONTEXT_TOKENS`)          |
| Contesto libri       | Sintesi dei capitoli nel prompt, più **tool** per leggere i capitoli e cercare nel testo                            |
| Contesto podcast     | **Trascrizione intera**, compattata in `[mm:ss] Speaker: testo`                                                     |
| Sintesi dei capitoli | Generate dall'LLM dopo l'ingestion, **nel repo e pubblicate** (`data/books/<id>/summary.json`)                      |
| Testo dei libri      | Resta nella cache locale, come oggi (`elib text`). Mai nel repo                                                     |
| Conversazioni        | **Storico locale** per fonte (localStorage). Da un messaggio si crea una **nota** nel pacchetto `notes`             |

## 3. Architettura

Nuovo pacchetto **`packages/chat`** (`@ehub/chat`):

```
packages/chat/src/
  node/
    config.ts        EHUB_AI_BASE_URL, EHUB_AI_API_KEY, EHUB_AI_MODEL, EHUB_AI_SUMMARY_MODEL, EHUB_AI_MAX_CONTEXT_TOKENS
    llm.ts           provider `createOpenAICompatible` dell'AI SDK, modelli `smart` per chat e sintesi
    agent.ts         `streamText` con tool e limite di passi (il loop lo fa l'AI SDK)
    sources/
      book.ts        prompt (metadati + sintesi capitoli) + tool: list_chapters, read_chapter, search_book
      episode.ts     prompt (metadati + trascrizione compattata)
      (la sorgente `exploration` vive in `@ehub/explore/chat`, vedi Fase 6)
  server/app.ts      POST /api/chat → UI message stream dell'AI SDK (testo, tool call, risultati)
  web/
    chat-panel.tsx   pannello laterale (Sheet shadcn) con `useChat` di `@ai-sdk/react`, Markdown, chip dei tool
    history.ts       storico in localStorage (`ehub:chat:<kind>:<id>`)
  test/mock-llm.ts   server OpenAI finto (HTTP) per provare il provider; per l'agente si usa il mock model dell'AI SDK
```

- **Montaggio**: in `apps/web/vite.config.ts` un altro `devServer` per `/api/chat`, come per le note. Il pulsante "Chatta" esiste solo quando `__ELIB_ADMIN__` è vero.
- **Accesso ai dati**: il server di chat legge direttamente i file (`data/books/<id>/`, la cache di `elib text`, `podcasts/data/transcripts`). `@ehub/library` e `@ehub/podcasts` esportano le poche funzioni che servono (lettura del libro, della sintesi, del testo, della trascrizione).
- **Budget**: stima dei token (parole × 1,4), contro l'80% della finestra (default 1M). Se una trascrizione supera il budget, si passa al tool `read_transcript(from, to)`, come per i libri.
- **Tool dei libri**: `read_chapter(n, offset?)` restituisce il testo a blocchi (circa 8k token), così un capitolo lungo non satura il contesto. `search_book(query)` cerca con grep e restituisce frammenti con il numero del capitolo.
- **Citazioni**: il system prompt chiede di citare capitolo o minuto. Nell'interfaccia i minuti diventano link al punto dell'episodio (c'è già `lib/timestamps`).

## 4. Sintesi in fase di ingestion

- **Formato** `data/books/<id>/summary.json`: `generatedAt`, `model`, `language`, `book` (sintesi del libro) e `chapters[]` (`n`, `title`, `words`, `summary`). Validato con Zod in `shared/schema.ts` e dalla validazione dei dati del sito.
- **CLI** `elib summarize <id> [--force]` e `elib summarize --missing`:
  1. lancia `elib text` se il testo non è in cache;
  2. sintetizza ogni capitolo (map), dividendo a blocchi i capitoli lunghi;
  3. scrive la sintesi del libro a partire da quelle dei capitoli (reduce).
- **Aggancio all'interfaccia**: un pulsante "Genera sintesi" nella pagina admin del libro. Non blocca l'upload: è un passo separato.
- **Copyright**: sono parole del modello, non estratti. Il prompt vieta citazioni lunghe.
- **Bonus**: le sintesi compaiono anche nella pagina del libro sul sito.

## 5. Test

- **Mock**: un server OpenAI finto (Hono) con risposte e tool call scriptate. Lo usano i test vitest di `llm`, `agent` e `server`, e la generazione delle sintesi.
- **Endpoint reale**: lo script `pnpm --filter @ehub/chat smoke` fa una richiesta semplice, una in streaming e una con tool call, così si verifica che l'endpoint supporti tutto.
- **Nota del 12/11**: `exampleopenaiendpoint-production.up.railway.app` risponde `404 Application not found` su ogni rotta. Si usa il mock finché non arriva l'endpoint vero.

## 6. Fasi

Il codice lo scrivono subagent (Haiku), una fase alla volta. Il coordinatore fa la revisione e lancia typecheck e test a ogni fase.

1. **Fondamenta**: pacchetto `@ehub/chat`, config, client LLM, loop dell'agente, mock e smoke test.
2. **Chat sugli episodi**, da capo a fondo: sorgente `episode`, `/api/chat`, pannello nella pagina dell'episodio. È la prima perché i dati esistono già.
3. **Sintesi dei libri**: schema, `elib summarize`, pulsante admin, sintesi nella pagina del libro.
4. **Chat sui libri**: sorgente `book` con i tool, pannello nella pagina del libro.
5. **Storico e note**: persistenza per fonte e "Salva come nota".
6. **Esplorazioni**: dopo la Fase 1 di [esplorazioni.md](esplorazioni.md), sorgente `exploration` con tool multi-fonte.

## 7. Decisioni prese il 12/11

- **Rapporto con la skill di esplorazione**: la scelta di [esplorazioni.md](esplorazioni.md) §2 è ribaltata. L'AI entra nell'app, e quel file va aggiornato.
- **Modello**: l'endpoint espone un tier **`smart`**, usato per la chat e per le sintesi (`EHUB_AI_MODEL=smart`).
- **Tool calling**: supportato dall'endpoint. Non serve il ripiego.
- **Lingua**: quella del chiamante. La chat risponde nella lingua della domanda. Le sintesi prendono la lingua come parametro (`elib summarize --lang`, oppure la lingua scelta nell'interfaccia admin), non quella del libro.

## 8. Stato al 12/11

- **Fase 1 (fatta)**: `@ehub/chat` sull'AI SDK v7. Smoke test verde contro il router locale (`freeway`, `127.0.0.1:4100`).
- **Fase 2 (fatta)**: chat sugli episodi. Pulsante "Chatta" nella pagina dell'episodio, solo in dev. Sotto ogni risposta compaiono il modello che ha risposto e i token. I timestamp sono link a YouTube. L'header `x-router-session` è uno per conversazione. Provata nel browser sull'episodio di Lex Fridman: circa 53k token di contesto, risposta da `gemini-3.6-flash`.
- **Fase 3 (fatta)**: le sintesi dei libri.
  - `elib summarize <id> | --missing [--lang it] [--force]`, più il pulsante admin "Genera sintesi".
  - Le sintesi usano il tier **`fast`** con `reasoning_effort: none` (`EHUB_AI_SUMMARY_MODEL`, `EHUB_AI_SUMMARY_REASONING_EFFORT`), mentre la chat resta su `smart`.
  - Le parti accessorie (copyright, note, ringraziamenti…) e i capitoli sotto le 150 parole vengono saltati.
  - C'è un controllo della lingua, con un nuovo tentativo se è sbagliata.
  - Prova vera su "Four Thousand Weeks": 17 capitoli in circa 1–2,5 minuti.
  - Per i test c'è un libro finto in `packages/chat/test/fixtures/books/fx000001/`. Il campo `summary` degli episodi è ancora vuoto.
- **Fase 4 (fatta)**: la chat sui libri, con i tool `list_chapters`, `read_chapter` e `search_book`. Il testo si carica alla prima chiamata a un tool. Provata contro il router: il modello cerca in inglese se il libro è in inglese, legge il capitolo e cita "(cap. N)".
  - Gli errori del router compaiono in italiano, con il tempo d'attesa.
  - Le sintesi aspettano su 429/503 e riprendono dai capitoli salvati in cache.
- **Limiti dei piani gratuiti**: le prove del 12/11 hanno esaurito le quote giornaliere di OpenRouter, OpenCode e Gemini. Una sintesi di un libro intero costa circa 20–30 chiamate.
- **Da rivedere**: alcuni test web della libreria stanno in `src/web/` e nessun tsconfig li controlla, e un test importa il mock LLM con un `import` dinamico. Va aggiunta una configurazione TypeScript per i test.
- **Fase 5 (fatta)**: storico delle conversazioni in localStorage e "Salva come nota" (commit `28b84be`).
- **Fase 6 (fatta, v1 solo libri)**: la sorgente `exploration`, in `packages/explore/src/chat/` e collegata in `apps/web/server/chat-dev.ts`. Dettagli in [esplorazioni.md](esplorazioni.md) §12.
  - Prompt: domanda, stato, per ogni libro ID, origine (in libreria / solo da esplorare), verdetto attuale e sintesi dei capitoli (o l'elenco dal manifest in cache), poi sintesi, note e il **diario delle sessioni precedenti**, anche quelle fatte con la skill.
  - Tool su più libri (`@ehub/library/explore`): `list_chapters({ book })`, `read_chapter({ book, chapter, part? })`, `search_book({ query, book? })`, che senza `book` cerca in tutti i libri. I tool del libro singolo non cambiano.
  - `propose_verdicts({ verdicts, summary?, journal? })` non scrive nulla. Il pannello ha un nuovo prop `renderToolPart`, con cui la pagina dell'esplorazione sostituisce il chip con una scheda modificabile: si salva solo con "Conferma e salva".
  - "Salva come nota" salva la risposta come nota dell'esplorazione.
  - Lo storico locale è per esplorazione (`ehub:chat:exploration:<id>`).
  - Provata nel browser il 12/11 contro il router: ricerca, lettura di un capitolo, proposta confermata e salvata (vedi [esplorazioni.md](esplorazioni.md) §12, "Prove del 12/11").
  - **Note e reload (risolto 12/11)**: anche `apps/web/src/notes-data.ts` usa `import.meta.glob` su `packages/notes/data`; ora `packages/notes/data` è escluso dal watch di Vite come le esplorazioni, così salvare una nota non ricarica la pagina né chiude la chat.
- **Fase 7 (fatta, 12/11)**: rifinitura.
  - **Pannello**: non è più un foglio modale. Sta agganciato a destra senza bloccare la pagina, si ridimensiona dal bordo sinistro (anche con le frecce; doppio clic per tornare a 480 px; la larghezza resta in localStorage), si ingrandisce in una finestra centrata e si chiude con la X, con Esc o di nuovo con "Chatta". Su telefono occupa lo schermo. Messaggi con avatar, schede per i tool, "Copia" e "Salva come nota" sotto ogni risposta, indicatore "Sta pensando…", pulsante per tornare in fondo.
  - **Note scritte dall'AI**: tool `save_note` lato client, aggiunto dal server a ogni fonte. Quando l'utente dice "aggiungilo alle note", il modello chiama il tool con un testo autonomo; il browser salva la nota con lo stesso `onSaveNote` del pulsante (libro, episodio o esplorazione), risponde al tool e il modello conferma. La nota compare nella chat come scheda.
  - **Endpoint**: il default di `EHUB_AI_BASE_URL` è freeway sul Raspberry Pi, `https://freeway.gabrieleghisleni.dev/v1`; il router locale (`127.0.0.1:4100`) si usa solo impostando la variabile. Serve un token valido sul Pi in `EHUB_AI_API_KEY`.
  - **Sintesi in parallelo**: tutte le chiamate al modello di una sintesi (capitoli, parti dei capitoli lunghi, unione) passano da un unico limitatore, 4 alla volta di default (`EHUB_AI_SUMMARY_CONCURRENCY`, massimo 8). Un libro nuovo nella libreria avvia la sintesi in background dopo la creazione.
- il modello a volte cita frasi lunghe (circa 25 parole) nonostante il prompt; la metadata del modello arriva solo a fine risposta.

## 9. Stato al 13/11

- **Note in Markdown**: le note si leggono come Markdown (grassetti, elenchi, citazioni, link; `@ehub/notes`, `NoteMarkdown`). "Salva come nota" non appiattisce più la risposta: la domanda va in grassetto in cima, la riga d'origine in corsivo in fondo. Il tool `save_note` chiede testo in Markdown con riga iniziale in grassetto e `(cap. N)`.
- **Pannello ingrandito**: testo più grande (`textSize="large"` di `MessageList`, contesto `ChatTextSizeContext`). I podcast usano un loro renderer e non lo seguono ancora.
- **Modalità appunti** (decisa il 13/11): interruttore "Appunti" nel campo di testo, ricordato per fonte (`ehub:chat-notes-mode:<kind>:<id>`).
  - Il client manda `notesMode: true`; il server aggiunge `NOTES_MODE_INSTRUCTIONS` al prompt: riga in grassetto con l'argomento, uno o due paragrafi brevi di prosa con i concetti in grassetto, `(cap. N)`, al massimo una citazione, niente preamboli.
  - Sotto ogni risposta "Aggiungi alla bozza" sostituisce "Salva come nota". La bozza (`ehub:chat-draft:<kind>:<id>`, `notes-draft.ts`, `draft-panel.tsx`) sta a lato nel pannello ingrandito e al posto della conversazione in quello agganciato. Si modifica, si riordina, si svuota; "Salva come nota" la salva come una nota sola e la svuota.
  - Se l'utente dice "salvalo", `save_note` finisce nella bozza: il browser risponde al modello «Aggiunta alla bozza degli appunti.».
  - I capitoli restano `(cap. N)`, il numero del manifest (scelta dell'utente).
- **Feel rich**: interruttore accanto ad "Appunti"; il client manda `rich: true` e il server usa `EHUB_AI_RICH_MODEL` (default `gpt-6-luna`). Non è ancora su freeway: finché il router risponde 400/404, la chat dice che il modello non è disponibile. Non viene ricordato tra un caricamento e l'altro.
- **Sottolineature**: `elib sync` le riporta dal Kobo in `data/books/<id>/highlights.json`. La chat non le vede ancora (proposta C dello schema del 13/11).
- **Quaderno delle esplorazioni (13/11)**: nella chat di un'esplorazione, "Salva come nota" diventa "Aggiungi al quaderno" (etichette in `noteLabels`), che accoda la domanda in grassetto e la risposta al quaderno condiviso. Il tool `save_note` fa lo stesso. Il nuovo tool `propose_notebook({ body })` mostra una scheda: l'utente conferma la riscrittura completa ("Sostituisci il quaderno") oppure l'aggiunta in fondo. Nulla cambia prima della conferma. La pagina dell'esplorazione si aggiorna subito, accanto alla chat.

