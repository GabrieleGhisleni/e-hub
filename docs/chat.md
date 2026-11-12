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
| **Esplorazione**   | La domanda, le sintesi di tutte le fonti                        | Leggere capitoli e tratti di trascrizione, cercare nelle fonti |

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
      exploration.ts unione delle fonti + tool multi-fonte (Fase 5)
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
- il modello a volte cita frasi lunghe (circa 25 parole) nonostante il prompt; la metadata del modello arriva solo a fine risposta.
