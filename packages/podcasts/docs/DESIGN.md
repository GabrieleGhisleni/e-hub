# e-podcasts — Design e piano di implementazione

Documento di riferimento. Raccoglie **tutte** le decisioni prese nella sessione di design del 2026-11-09, comprese le alternative scartate e i fatti verificati che le motivano. Niente codice: solo scelte, struttura e fasi.

Le correzioni emerse dalla review dello stesso giorno sono integrate nelle sezioni pertinenti. In §16 sono le decisioni 36–48; le righe modificate sono segnate con _(rivista)_.

---

## 1. Scopo

- Strumento **personale** (un solo utente: io).
- Catalogo dei podcast **già ascoltati**, compresi quelli ascoltati prima della nascita del progetto (import iniziale, §4.2) — inizialmente Lex Fridman Podcast e Huberman Lab, ma aperto a qualsiasi podcast/video YouTube.
- Navigazione veloce e piacevole, con categorie (tag) e ricerca.
- Per ogni episodio: link, appunti (summary + notes) e le conversazioni avute con un agente sull'episodio.
- Le **trascrizioni** servono **solo in locale**, come materiale per discutere l'episodio con un agente e produrre gli appunti; non vengono pubblicate.
- Flusso d'uso tipico: ascolto un episodio → lo aggiungo → passo la trascrizione a un agente e ci faccio brainstorming → l'agente produce summary/notes/tag nel formato del progetto → incollo anche la conversazione (ripulita automaticamente da eventuali estratti della trascrizione, §5.1) → tutto finisce nei JSON dell'episodio e sul sito.
- L'agente con cui discuto può essere **qualsiasi** (claude.ai, ChatGPT, Claude Code…). Inizialmente era fuori dal progetto; poi si è deciso di includere nel repo una **skill di Claude Code** dedicata (§10), mantenendo il supporto agli altri agenti tramite copia/incolla (§8.5).

---

## 2. Architettura

### 2.1 Decisione: file JSON nel repo, scritture solo in locale

- I dati vivono come **file JSON versionati in git**. Nessun database.
- Le modifiche avvengono **solo in locale** (UI locale, CLI, skill di Claude Code).
- Il sito pubblicato è **statico e in sola lettura**.

**Motivazioni**: zero infrastruttura e zero costi; git fa da database, backup e cronologia (si può annullare una modifica sbagliata di un agente); gli agenti scrivono file nativamente; funziona offline; dati portabili.

### 2.2 Alternativa scartata: Supabase (+ GitHub Pages)

Valutata e scartata per questo progetto. Problemi emersi:

- il piano gratuito **mette in pausa il progetto dopo 7 giorni di inattività** (fastidioso per uno strumento personale usato a intermittenza);
- nessun backup scaricabile nel piano free;
- la chiave anon sta nel browser: sicura solo se le policy RLS sono corrette;
- più manutenzione (schema, migrazioni, auth con redirect, Edge Functions);
- le note di un agente dovrebbero passare da API invece che da file;
- niente offline, lock-in moderato.

**Criterio generale** (valido anche per altri progetti): Supabase conviene se serve almeno una di queste tre cose — (1) scrivere da fuori dal PC, (2) dati privati pur su hosting pubblico, (3) più utenti / scritture concorrenti o tempo reale. Qui nessuna delle tre è necessaria.

Se in futuro servisse scrivere da remoto, l'evoluzione prevista è "file nel repo + GitHub Action lanciata dalla UI con un token", senza cambiare il formato dei dati.

### 2.3 Hosting

- **GitHub Pages**, pubblico, in sola lettura.
- Il piano Free di GitHub richiede un **repo pubblico** per Pages → il repo sarà **pubblico**. Non espone nulla in più del sito: le trascrizioni non sono in git.
- Alternative scartate: hosting protetto da login (Cloudflare Pages + Access); app solo locale senza pubblicazione.
- In locale l'app gira con il server di sviluppo di Vite, che ospita anche il server di scrittura (§9).

### 2.4 Cosa è pubblico e cosa no

| Contenuto                                  | In git                                          | Sul sito pubblico |
| ------------------------------------------ | ----------------------------------------------- | ----------------- |
| Metadati episodi e show                    | sì                                              | sì                |
| Tag, summary, notes                        | sì                                              | sì                |
| Conversazioni con l'agente                 | sì (ripulite dagli estratti della trascrizione) | sì                |
| Immagini degli show                        | sì                                              | sì                |
| Trascrizioni                               | **no (gitignored)**                             | **no**            |
| File audio                                 | **no** (cancellati dopo l'uso)                  | no                |
| Cache locali (clone PatrykWajs, mappa Lex) | **no (gitignored)**                             | no                |

Motivo per le trascrizioni: sono contenuto di terzi protetto da copyright e non servono sul sito — servono solo in locale per lavorare con l'agente.

Il `.gitignore` da solo non basta: una trascrizione può rientrare dentro una conversazione incollata o dentro le notes. Le difese sono il controllo in `core` al salvataggio (§5.1) e i controlli in CI (§11).

---

## 3. Stack

- **pnpm**, **un solo pacchetto** (niente workspace/monorepo: avrebbe senso solo pubblicando `core` come pacchetto separato), **TypeScript**.
- Runtime: **Node LTS** corrente, versione fissata in `package.json` (`engines`); CLI e script TypeScript eseguiti con **`tsx`**.
- Frontend: **React puro + Vite + Tailwind CSS + shadcn/ui** (SPA).
- **Niente Next.js**: l'export statico per Pages non supporta route API/server actions e un backend Next non serve; la complessità non è giustificata.
- Server di scrittura locale: **Node + Hono**, montato dentro il server di sviluppo di Vite con **`@hono/vite-dev-server`** (un solo processo, niente proxy). Mai pubblicato.
- Validazione: **Zod**.
- Test: **Vitest** — parser delle fonti, merge di `episode save`, export markdown, controllo delle trascrizioni (§5.1).
- Ricerca: **MiniSearch**, lato client, indice costruito in memoria al caricamento. Pagefind (indice statico a build time) era stato considerato quando si pensava di cercare anche nelle trascrizioni; scartato perché sul sito ci sono solo metadati e appunti di < 100 episodi.
- Trascrizione: **Python gestito con uv** (faster-whisper, diarize, yt-dlp). _Superato (2026-11): `pnpm transcribe` usa Groq `whisper-large-v3-turbo` da TypeScript (`src/cli/transcribe/groq.ts`, `docs/hosting.md`); la cartella `transcriber/` è stata rimossa e le trascrizioni non hanno più speaker._
- Lint/format: **oxlint** e **oxfmt** (già configurati nel repo).

### 3.1 Struttura del repo

- `src/core/` — schema Zod, lettura/scrittura JSON, logica di ingest (riconoscimento show, metadati, recupero trascrizioni da Lex / PatrykWajs, creazione show), controllo delle trascrizioni (§5.1).
- `src/server/` — app Hono, strato sottile sopra `core`, montata in Vite in sviluppo.
- `src/cli/` — CLI usata dalle skill e dagli script.
- `src/web/` — app React.
- `transcriber/` — progetto Python (uv) per audio → trascrizione.
- `data/shows/`, `data/episodes/`, `data/conversations/` — dati versionati.
- `data/transcripts/`, `data/audio/`, `data/cache/` — locali, gitignored. `data/cache/` contiene il clone di PatrykWajs e la mappa `youtubeId` → pagina di trascrizione Lex.
- `public/shows/` — immagini degli show.
- `tests/fixtures/` — esempi **ridotti o sintetici** delle fonti: il repo è pubblico e una pagina di trascrizione completa è testo protetto.
- `.claude/skills/` — le due skill del progetto.
- `AGENTS.md` — convenzioni per gli agenti.
- `docs/DESIGN.md` — questo documento.

---

## 4. Modello dati

Schema validato con Zod, con un campo **`extra`** libero per flessibilità futura senza perdere la validazione. Un file per entità (diff git leggibili, nessun file gigante da riscrivere).

Gli slug di show ed episodi sono validati con una regex (`^[a-z0-9]+(-[a-z0-9]+)*$`) prima di essere usati come nome di file o URL.

### 4.1 Show — `data/shows/<slug>.json`

- nome, autore/host, link (sito, YouTube), **URL del feed RSS**, immagine.
- Immagine scaricata **una volta** alla creazione dello show e salvata nel repo in `public/shows/<slug>.webp` (fonte: copertina dal feed RSS o avatar del canale YouTube).
- Lex e Huberman: feed inseriti a mano. Show nuovi: feed cercato con l'**API iTunes Search** (gratuita, senza chiave). L'abbinamento canale YouTube ↔ podcast è incerto, quindi il feed proposto **va confermato** (domanda nella CLI, conferma nel form della UI). Se non si trova o non si conferma, lo show usa solo YouTube.

### 4.2 Episodio — `data/episodes/<slug>.json` (in git)

- Metadati: titolo, **ospiti** (`guests: string[]`, anche vuoto: Lex ha episodi con più ospiti, Huberman molti episodi senza), show, **numero di episodio** (`number`, opzionale), link originale, `youtubeId`.
- **`guestDescriptions`** (opzionale): una breve descrizione per nome dell’ospite, modificabile dall’editor locale o con `pnpm episode save`.
- Date:
  - **`publishedAt`** (opzionale): data di pubblicazione, da HTML Lex, frontmatter PatrykWajs, feed RSS o pagina YouTube. Serve all'abbinamento con il feed (§7.2) ed è mostrata in lista.
  - **`addedAt`**: automatica (data di aggiunta = data di "ascolto"). Solo per l'**import iniziale** degli episodi già ascoltati la CLI accetta `--added-at <data>`; dalla UI non si modifica.
  - **`updatedAt`**: aggiornata a ogni salvataggio (appunti, tag, ospiti, conversazioni); fa anche da controllo di versione (§5).
- `transcriptSource`: provenienza della trascrizione locale (`lex-official`, `patrykwajs-wiki`, `whisper-local`) o assente.
- `transcriptTimebase`: `youtube` o `feed`, cioè su quale audio sono misurati i timestamp della trascrizione (§4.3). Assente se non c'è trascrizione.
- `tags`: lista piatta, multivalore.
- `summary`: breve, 3–5 punti chiave; mostrato anche nella lista.
- `notes`: appunti estesi in markdown.
- `extra`: libero.

**Conversazioni — `data/conversations/<slug>.json` (in git)**: lista di elementi semplici `{date, agent, markdown}` — la chat con l'agente incollata così com'è, ripulita dagli estratti della trascrizione (§5.1). Stanno in un file separato dall'episodio perché possono essere lunghe: il sito le carica solo nel dettaglio (§8.1).

Niente campo `status`: per ora ogni episodio salvato è "ascoltato". I "commenti datati" proposti inizialmente sono stati scartati in favore di summary + notes + conversations.

### 4.3 Trascrizione — `data/transcripts/<slug>.json` (gitignored)

- Formato **unico** per tutte le fonti, così app e agenti non devono conoscere l'origine.
- Segmenti `{speaker?, start, text}` (speaker opzionale) + capitoli.
- **`timebase`**: `youtube` se i timestamp sono misurati sul video, `feed` se sull'MP3 del podcast. La versione podcast ha intro e pubblicità diverse dal video, e Megaphone (Huberman) di norma inserisce le pubblicità al momento del download: i timestamp `feed` **non** corrispondono al video e lo scarto non è costante.
  - Lex ufficiale e PatrykWajs → `youtube`.
  - Whisper → dipende dall'audio usato (§7.2), che viene registrato nella trascrizione (`audio: {source, url}`).
- I timestamp permettono link a YouTube al secondo esatto (via `youtubeId`) **solo con `timebase: youtube`**.
- La **correzione degli speaker** (scambio host/ospite; con più ospiti, nome per ogni speaker) modifica questo file locale.
- Mappatura delle fonti nel formato unico:
  - Lex: speaker, timestamp e capitoli (`h2`) dall'HTML ufficiale.
  - PatrykWajs: timestamp `[HH:MM:SS]` per riga, nessuno speaker (campo assente), nessun capitolo. _(aggiornato in fase 4)_: molti file hanno invece titoli `## [HH:MM:SS] capitolo` con paragrafi senza orario ed etichette `**Nome:**`; diventano capitoli e speaker, e gli orari dei paragrafi sono interpolati per numero di parole (`extra.estimatedStarts`). Dei 453 file, 12 non hanno timestamp: episodio salvato senza trascrizione.
  - Whisper: segmenti con timestamp + speaker da `diarize`, nessun capitolo.

### 4.4 Trascrizione per l'agente: intera, in markdown compatto (niente RAG)

- Per discutere **un singolo episodio** la trascrizione si passa **intera** all'agente. Stima: ~150 parole/min → un episodio di 3 h ≈ 27k parole ≈ **35–40k token**, che stanno comodamente nel contesto. Alcuni episodi di Lex superano le 4–5 ore (~50–60k token): stanno nel contesto di Claude, ma possono superare il limite di testo incollabile di altri agenti.
- **Niente RAG**: frammenterebbe il filo del discorso, necessario per riflettere sull'episodio. Serve solo per domande trasversali a più episodi (fuori dalla v1).
- **Niente tool dedicati** per navigare la trascrizione: in Claude Code l'agente ha già Read/Grep.
- Il JSON a segmenti non si passa all'agente (troppi token, poco leggibile). Si usa un **export markdown compatto**: intestazione (titolo, ospiti, link, `timebase`), capitoli come `##`, segmenti consecutivi dello stesso speaker **uniti in paragrafi** con un timestamp all'inizio di ciascuno (`**Lex** [01:23:45] …`).

### 4.5 Convenzioni di contenuto

- **UI in italiano.**
- Appunti in lingua libera (probabilmente inglese).
- **Tag sempre in inglese e minuscolo** (`sleep`, `dopamine`, `ai`), per evitare doppioni. I tag li propone l'agente; `pnpm tags` elenca quelli esistenti con i conteggi leggendo i JSON, e skill e `AGENTS.md` rimandano a quel comando invece di tenerne una copia (che invecchierebbe).
- **Citazioni dalla trascrizione** negli appunti: brevi (meno di 20 parole); per il resto parafrasi e timestamp (§5.1).
- Lo **show non è un tag**: è un filtro separato.

---

## 5. Unico punto di scrittura validato

- Né la UI né le skill modificano i JSON a mano: passano tutte da `core`, esposto tramite **CLI** e **server**.
- CLI:
  - `pnpm episode add <url> [--added-at <data>]` — aggiunge un episodio (e lo show se nuovo); `--added-at` solo per l'import iniziale.
  - `pnpm episode save <slug> --input <file> [--expected-updated-at <ts>]` — valida con Zod e applica:
    - summary / notes / tags / guests **presenti** nell'input sovrascrivono; quelli **assenti** restano invariati (non vengono svuotati);
    - le conversazioni vengono **aggiunte**, scartando quelle già presenti (stesso hash del markdown): rilanciare lo stesso input non le duplica;
    - se `--expected-updated-at` non coincide con l'`updatedAt` del file, il salvataggio è **rifiutato** (qualcun altro ha scritto nel frattempo). Il server lo passa sempre; la skill lo passa con l'`updatedAt` letto all'inizio.
  - `pnpm tags` — elenca i tag esistenti con i conteggi. Sola lettura.
  - `pnpm transcribe <slug>` — lancia il transcriber Python.
  - `pnpm transcript export <slug>` — produce la trascrizione in markdown compatto per l'agente (§4.4). Sola lettura.
- Obiettivo: un agente non può corrompere i dati, e UI e skill non si sovrascrivono a vicenda.

### 5.1 Protezione delle trascrizioni

- Al salvataggio, `core` confronta il testo con la trascrizione locale dell'episodio cercando sequenze di **≥ 20 parole consecutive** identiche (dopo aver normalizzato maiuscole e punteggiatura).
- **Conversazioni**: le sequenze trovate vengono **rimosse** e sostituite da `[estratto della trascrizione rimosso]`; il salvataggio riporta quante. Casi tipici: il primo messaggio di una chat su claude.ai aperta con "Copia per l'agente", o l'output di `pnpm transcript export` dentro un export di Claude Code.
- **Summary e notes**: se ci sono sequenze, il salvataggio è **rifiutato** con errore (l'agente deve parafrasare o accorciare la citazione).
- Senza trascrizione locale il confronto non è possibile: vale una soglia di dimensione per conversazione (indicativamente 200 KB, da tarare) oltre la quale il salvataggio è rifiutato.

---

## 6. Aggiunta di un episodio (ingest)

Si incolla un URL; lo show viene riconosciuto automaticamente:

- **Lex Fridman** — `lexfridman.com/...` **o video YouTube del canale di Lex** (riconosciuto dall'`author_url` di oEmbed): metadati + trascrizione ufficiale. Da un URL YouTube la pagina `-transcript` si trova con una mappa `youtubeId` → pagina, costruita leggendo le pagine dell'indice "transcripts" e tenuta in `data/cache/`; si aggiorna quando un id non c'è.
- **Huberman** — `hubermanlab.com/...` o video YouTube di Huberman: trascrizione da PatrykWajs.
- **Qualsiasi altro URL YouTube**: show generico (uno per canale), metadati via **oEmbed**, trascrizione via Whisper locale. oEmbed non restituisce la data: `publishedAt` si prova a leggere dalla pagina del video, altrimenti resta vuota.

Per tutte le fonti:

- **Ospiti**: estratti dalla fonte quando possibile (Lex: pagina dell'episodio; Huberman: parte del titolo prima dei due punti, se è un nome); altrimenti vuoti e modificabili dalla UI locale.
- **Numero di episodio**: dal titolo o dalla fonte, quando c'è.

Se lo show non esiste viene creato (con immagine e feed confermato, §4.1). Se non si trova una trascrizione, l'episodio viene **salvato comunque**, con badge "nessuna trascrizione" e possibilità di lanciare Whisper.

### 6.1 Fonti delle trascrizioni — fatti verificati il 2026-11-09

**Lex Fridman**

- Trascrizioni gratuite e pubbliche su `lexfridman.com/<slug>-transcript` (indice: categoria "transcripts").
- Copertura: circa **123 episodi su ~500**, soprattutto recenti.
- HTML WordPress ben strutturato: segmenti con speaker, timestamp linkato a YouTube al secondo, testo; capitoli come titoli `h2`. Nessun JSON.
- Il feed RSS **non** contiene tag `<podcast:transcript>`; robots.txt non restringe l'uso personale.
- I link dei timestamp contengono l'ID del video YouTube → fonte del `youtubeId` dell'episodio e della mappa `youtubeId` → pagina (§6).
- **Decisione**: si usa sempre l'HTML ufficiale; se la pagina manca, episodio senza trascrizione → Whisper. Il fallback sui sottotitoli YouTube (esistono tracce inglesi manuali) è stato scartato per la v1.

**Huberman Lab**

- Le trascrizioni ufficiali sono una **funzione Premium a pagamento** (Supercast), con lacune; il testo è presente nell'HTML ma nascosto dal paywall, e i ToS vietano i bot.
- **Decisione**: **escluso** qualsiasi recupero dalle pagine Premium (sarebbe aggirare un paywall), incluso il tool che usa il cookie di un abbonato.
- **Fonte scelta: repo GitHub `PatrykWajs/Huberman-Lab-Wiki`** — licenza MIT (del repo; il testo resta di Huberman Lab, per questo lo si usa solo in locale), aggiornato settimanalmente (ultimo commit 2026-11-08), ~453 episodi fino a EP-454; un `transcript.md` per episodio con frontmatter (data, numero, `youtube_id`) e timestamp `[HH:MM:SS]`, senza nomi degli speaker (sembrano sottotitoli YouTube ripuliti).
- **Accesso tramite clone locale**: `git clone --depth 1` in `data/cache/huberman-wiki/`, aggiornato con `git pull` a ogni ingest Huberman, più un indice locale `youtube_id` / numero / titolo → file. Motivo: trovare un episodio richiede di leggere il frontmatter di ~450 file e l'API GitHub senza token concede 60 richieste l'ora; inoltre la copia locale resta anche se il repo sparisce.
- Match per `youtube_id`, poi numero di episodio, poi titolo; se l'episodio manca → Whisper. _(rivisto in fase 4)_: la numerazione del wiki non coincide con quella ufficiale (es. EP-374 del wiki = #270 ufficiale), quindi il match è per `youtube_id` e poi per titolo normalizzato, senza numero.
- Alternative considerate: scaricare noi i sottotitoli automatici YouTube (`yt-dlp`/`youtube-transcript-api`, stessa qualità ma richiede Python nell'ingest e combatte con l'anti-bot di YouTube) o Whisper diretto. PatrykWajs scelto perché si legge da TypeScript con un clone git e file markdown, senza Python nell'ingest; Whisper resta il fallback e permette in futuro di ritrascrivere con diarizzazione dove serve.
- Altri repo valutati e scartati (fermi o parziali): mrlong0129/huberman-lab-transcripts, prakhar625/huberman-podcasts-transcripts, simicvm/hubcap, lord-denning/…; dataset HF Gopher-Lab (senza licenza).

### 6.2 Immagini

- Episodio: **miniatura YouTube** linkata direttamente, nessuna immagine episodio nel repo.
  - Lista: `i.ytimg.com/vi/<id>/hqdefault.jpg`, che esiste sempre.
  - Dettaglio: `maxresdefault.jpg` con ripiego su `hqdefault.jpg`, perché `maxresdefault` manca per molti video.
- Fallback: immagine dello show (salvata nel repo).

---

## 7. Trascrizione locale (Whisper)

### 7.1 Macchina

AMD Ryzen AI 7 350 (8 core / 16 thread), Radeon 860M integrata, **nessuna GPU NVIDIA**, 30 GB RAM. `uv` e `ffmpeg` presenti. → **tutto su CPU**.

### 7.2 Recupero dell'audio

Catena, in ordine:

1. **`yt-dlp`** sul `youtubeId`, se presente, solo traccia audio (verificato: opus ~50 kbps, ~77 MB). L'audio coincide con il video → `timebase: youtube`, quindi i timestamp diventano link YouTube validi.
2. **MP3 dal feed RSS** dello show (`<enclosure>`) → `timebase: feed`. Abbinamento per **numero di episodio** se noto, altrimenti titolo normalizzato + `publishedAt` (±3 giorni). Verificato: Lex su Blubrry (~160 MB per episodio recente), Huberman su Megaphone. Limite: il feed di Lex contiene **solo ~38 episodi recenti**; quello di Huberman ~457. _(aggiornato il 2026-11-10: il feed di Lex ora ha ~503 episodi, dal 2018)_. Copre i casi in cui YouTube blocca `yt-dlp` o l'episodio non è su YouTube.
3. Altrimenti, errore esplicito.

- L'ordine è invertito rispetto alla prima stesura (feed prima di `yt-dlp`): con l'audio del feed i timestamp non corrispondono al video (§4.3).
- L'audio usato viene registrato nella trascrizione (`audio: {source, url}`), così un abbinamento sbagliato col feed è visibile.
- `yt-dlp` è una dipendenza dell'ambiente uv del transcriber (non di sistema), aggiornata spesso.
- L'audio va in `data/audio/` (gitignored) e viene **cancellato a fine trascrizione**; flag `--keep-audio` per conservarlo (es. per ritrascrivere con un altro modello).
- Qualità audio irrilevante: viene convertito a 16 kHz mono con ffmpeg.

### 7.3 Trascrizione

- **faster-whisper, modello `small.en`, int8, trascrizione sequenziale** (`WhisperModel.transcribe` con VAD) _(rivista dopo la prova, §7.7)_: il pipeline batched perdeva interi blocchi di testo (WER 17,8% contro 11,3%). Modello piccolo e veloce: i podcast sono in inglese. Modello selezionabile con `--model`.
- **Timestamp per parola** (`word_timestamps`), necessari per assegnare gli speaker (§7.4).
- **`initial_prompt` / `hotwords`** con nome dello show, host e ospiti: migliora i nomi propri, il punto debole di `small.en`.
- Divisione in **blocchi da ~10 minuti** con ffmpeg, **solo per la trascrizione** e **per la ripresa** dopo un'interruzione (non per velocità: su CPU il lavoro totale non cambia). Blocchi già fatti in una cache temporanea.
- Stima: benchmark ufficiale faster-whisper (`small`, int8, batch 8, 8 thread) → RTF ≈ 0,065 → **~8 minuti per 2 ore di audio**. `large-v3-turbo`/`distil-large-v3` stimati ~40–60 min → fuori budget. Da misurare nella prova iniziale (§15, fase 2).
- Budget accettato: ~30 minuti per un episodio di 2 ore.
- Il benchmark comparativo tra modelli proposto inizialmente è stato abbandonato: si parte direttamente con il modello veloce (`small.en`), sufficiente per podcast in inglese.

### 7.4 Diarizzazione (chi parla)

- **`diarize`** (PyPI, Apache-2.0, nessun token HF), sempre attiva, eseguita **sull'audio intero, non sui blocchi**: diarizzando a blocchi le etichette (`SPEAKER_0`, `SPEAKER_1`) possono invertirsi da un blocco all'altro. Il risultato va in cache, così una ripresa non la ripete.
- Numero di speaker: `--num-speakers`, default = 1 + numero di ospiti (2 se gli ospiti non sono noti).
- Tempo dichiarato ~15 min per 2 h (numeri del progetto, non verificati). Totale stimato ~25 min.
- Assegnazione: ogni parola prende lo speaker con cui si sovrappone nel tempo; i segmenti Whisper vengono spezzati dove cambia lo speaker (negli scambi veloci un segmento può contenere due persone).
- Nomi: euristica **"il primo che parla è l'host"** (nome dallo show), gli altri sono gli ospiti in ordine di apparizione. Molti podcast aprono con una clip dell'ospite, quindi l'euristica sbaglierà spesso: la correzione dalla UI locale (§8.5) fa parte del flusso normale.
- Fallback opzionale via flag: **pyannote community-1** (richiede token HF, ~100 min per 2 h su CPU → fuori budget).
- Scartati: VibeVoice-ASR (troppo pesante per CPU), stack NVIDIA NeMo/Sortformer (orientato a GPU).

### 7.5 Output

Trascrizione nel formato unico (§4.3) con `timebase` e `audio`; sull'episodio `transcriptSource: whisper-local` e `transcriptTimebase`.

### 7.6 Lancio

- **Solo da CLI** (`pnpm transcribe <slug>`) nella v1, per evitare processi orfani legati al server di sviluppo.
- La UI mostra il badge "nessuna trascrizione" e il comando da copiare.
- La skill `/add-episode` può lanciarlo in background (§10).

### 7.7 Misure della prova (fase 2)

Misurato il 2026-11-10 su **Lex Fridman Podcast #502** (Andrew Scull, due speaker): <https://lexfridman.com/andrew-scull-transcript>, video YouTube `s7d2d8FhevU`. Primi **20 minuti** di audio (`yt-dlp`, nessun blocco da parte di YouTube; WAV 16 kHz mono). Riferimento: trascrizione ufficiale. Software: faster-whisper 1.2.1, `diarize` 0.1.2, Python 3.12 (la 3.14 di sistema non va: `torch<2.9` non ha wheel cp314). Dettagli e script in `transcriber/` e `docs/progress/phase-2.md`.

Condizioni: load average 0,4 prima della trascrizione, ~1,5 durante la diarizzazione (altri agenti attivi), CPU a 8 thread.

| Fase                                       | Tempo su 20 min                              | RTF    | Stima per 2 h           |
| ------------------------------------------ | -------------------------------------------- | ------ | ----------------------- |
| Caricamento modello `small.en`             | 1,4 s                                        | —      | trascurabile            |
| ASR `small.en` int8, **batched** (batch 8) | 56,7 s                                       | 0,047  | ~5,7 min                |
| ASR `small.en` int8, **sequenziale**       | 89,6 s                                       | 0,075  | ~9 min                  |
| `diarize` (2 speaker, audio intero)        | 75,8 s (di cui ~7 s di download del modello) | ~0,058 | ~7 min, se lineare      |
| **Totale (sequenziale + diarize)**         | ~2,8 min                                     |        | **~16 min** (budget 30) |

Qualità (solo testo normalizzato, minuscolo e senza punteggiatura, sui 20 minuti):

- **WER batched: 17,8%** (250 cancellazioni); **WER sequenziale: 11,3%**. Il pipeline batched **perde interi blocchi di testo** (finestre da ~30 s ridotte a poche parole, es. 55 parole sostituite da 5): inaccettabile per una trascrizione da leggere. Il sequenziale no. Buona parte del WER residuo è formattazione (numeri "1950s" vs "nineteen fifties", contrazioni, "gonna"/"wanna") e il parlato ripulito della trascrizione ufficiale, non errori veri.
- **Attribuzione degli speaker: 99,8%** delle parole allineate (con la mappatura ruolo, host/ospite). Nessun errore di numero di speaker (2 forniti).
- **Nomi propri**: con l'`initial_prompt` (show, host, ospite, temi) "Scull", "Freud", "Jung" corretti; errori sui termini rari ("iatrogenic" → "eatrogenic", "Rosenhan" → "Rosenhahn", "Steven" → "Stephen").
- **Euristica "primo che parla = host"**: giusta qui, perché l'episodio apre con l'introduzione di Lex. **Non** messa alla prova su un cold open con clip dell'ospite; il rischio del §14 resta.

**Raccomandazione per §7**: il piano regge (tempi ben dentro il budget, ~16 min contro ~30) e `diarize` funziona bene su due speaker. Modifiche suggerite:

1. **Usare la trascrizione sequenziale (`WhisperModel.transcribe`, VAD attivo), non `BatchedInferencePipeline`**: costa ~1,6x ma il batched perde testo. §7.3 va aggiornato di conseguenza; la stima RTF diventa ~0,075 (≈9 min per 2 h), non 0,065.
2. Con il margine guadagnato si può **provare `medium.en` o `distil-large-v3`** (da misurare in fase 8: RTF atteso 3–5x quello di `small.en`), per ridurre errori sui nomi; non necessario per partire.
3. Diarizzazione: la stima di ~15 min per 2 h era pessimistica (~7 min), ma la scalabilità su 2 h **non è misurata** (clustering spettrale) — da verificare nella prova da ~2 h della fase 8.
4. Fissare Python 3.12 e `av<17` (faster-whisper 1.2.1 non funziona con `av` 19).
5. Dubbi residui: cold open (euristica host), episodi con 3+ speaker (qui testato solo con 2).

**Fase 8 — episodio intero (2026-11-10)**: `pnpm transcribe` su **Lex Fridman Podcast #495** (Lars Brownworth, due speaker, si apre con un _cold open_ dell'ospite), video `iKx3gAODybU`, **2 h 03 min**, senza interruzioni. Blocchi da ~10 min, `small.en` int8 sequenziale, 8 thread. Dettagli in `docs/progress/phase-8.md`.

| Fase                                          | Tempo                                 | RTF   | Load average |
| --------------------------------------------- | ------------------------------------- | ----- | ------------ |
| Download `yt-dlp` (73,8 MB) + WAV             | 114,6 s + 7,9 s (altre volte 16–20 s) | —     | 0,5–0,7      |
| `diarize` (file intero, 2 speaker)            | 401,8 s (6,7 min)                     | 0,054 | 0,7 → 3,2    |
| ASR, 12 blocchi (+30 s di margine a sinistra) | 660,9 s (11,0 min)                    | 0,089 | 8–11         |
| **Totale `pnpm transcribe`**                  | **19 min 48 s** (budget 30)           |       |              |

- Qualità contro la trascrizione ufficiale: **WER 7,1%**, **speaker corretti per nome sul 99,4%** delle parole allineate, ≥ 98,9% in ogni finestra di 10 minuti (nessuno scambio di etichette lungo le 2 ore). La diarizzazione scala linearmente (RTF 0,054 contro 0,058 sui 20 minuti).
- **Cold open**: "primo che parla = host" avrebbe sbagliato; l'euristica è stata raffinata (se nei primi 10 minuti qualcuno pronuncia il cognome di un ospite, il primo a farlo è l'host che lo presenta) e qui ha dato i nomi giusti.
- **Bordi dei blocchi**: un blocco che inizia a metà frase, con l'`initial_prompt`, a volte fa saltare a faster-whisper l'intera prima finestra di 30 s (87 parole perse in una prova da 30 minuti). Rimedio: ogni blocco parte 30 s prima del suo inizio e tiene solo le parole il cui centro cade nel blocco (~5% di ASR in più); nella prova da 2 h nessuna perdita ai bordi.
- Interruzione e ripresa verificate: si riparte dal blocco successivo senza rifare la diarizzazione.

---

## 8. Frontend

### 8.1 Dati

- I JSON di show ed episodi sono importati con `import.meta.glob` **eager** e **inclusi nel bundle** a build time: nessun fetch, nessuna API sul sito. Il glob copre **solo** `data/shows/` e `data/episodes/`, mai `data/transcripts/`.
- Le conversazioni (`data/conversations/`) usano un `import.meta.glob` **non eager**: un chunk per episodio, caricato solo all'apertura del dettaglio. Sono la parte più lunga dei dati e non servono né alla lista né alla ricerca.
- In locale, quando il server scrive un file, Vite ricarica automaticamente: il frontend **legge sempre dai file**, il server serve **solo a scrivere** (e a leggere le trascrizioni locali, che non sono nel bundle).
- Volume previsto: **< 100 episodi**.

### 8.2 Routing

- URL puliti. In fase di build, per ogni episodio `index.html` viene copiato in `dist/episode/<slug>/index.html`: un link diretto risponde con status 200 e mostra l'app, che legge l'URL.
- `index.html` viene copiato anche in `404.html`, come ripiego per URL non previsti (GitHub Pages lo serve con status 404). L'hash router (`/#/episode/xyz`) resta l'ultimo ripiego se questi meccanismi dessero problemi.
- Vite configurato con `base: '/e-podcasts/'`; il router usa `import.meta.env.BASE_URL` come base.

### 8.3 Lista episodi (home)

- Lista **densa**, a colonna singola (non card), **visivamente piacevole**.
- Per riga: miniatura, **titolo in grande e leggibile**, poi ospiti, show, data, tag; summary visibile.
- Ordinamento: più recenti prima (per `addedAt`).
- In alto: filtri per **show** e per **tag**, barra di **ricerca full-text** (MiniSearch) su titolo, ospiti, tag, summary e notes. Nessuna ricerca nelle trascrizioni (non sono sul sito); niente ricerca semantica.

### 8.4 Dettaglio episodio

- Metadati, link a episodio originale e YouTube, e dialogo con le presentazioni degli ospiti disponibili nel catalogo.
- Summary in evidenza, poi notes.
- I timestamp `[HH:MM:SS]` nelle notes diventano link a YouTube al secondo **solo se** `transcriptTimebase` è `youtube`; altrimenti restano testo.
- Conversazioni in sezione richiudibile, caricate a richiesta (§8.1).
- **Nessuna trascrizione completa** sulla pagina (non serve per consultare gli appunti).

### 8.5 Funzioni solo locali

Visibili solo con `import.meta.env.DEV` e caricate con un import dinamico dentro quel controllo, così restano fuori dal bundle di produzione (verificato in CI, §11):

- form **"Aggiungi da URL"** (con conferma del feed per gli show nuovi, §4.1);
- editor di summary / notes / tags / ospiti e relative presentazioni;
- **"Aggiungi conversazione"** (incolla markdown; dice quanti estratti della trascrizione sono stati rimossi, §5.1);
- badge "nessuna trascrizione" + comando `pnpm transcribe` da copiare.

Se un salvataggio è rifiutato per conflitto di versione (§5), l'editor lo segnala e propone di ricaricare senza perdere il testo scritto.

---

## 9. Server locale

- **Hono** su Node, solo in sviluppo, mai deployato.
- Montato dentro il server di sviluppo di Vite con `@hono/vite-dev-server`: `pnpm dev` è solo `vite`, un processo, nessun proxy.
- Endpoint sottili sopra `core`: aggiunta episodio, salvataggio appunti (con l'`updatedAt` atteso), aggiunta conversazione, correzione speaker, esportazione della trascrizione locale.
- Sicurezza (il server scrive file che finiscono in un repo pubblico):
  - in ascolto solo su `localhost` (default di Vite; non usare `--host`);
  - le richieste in scrittura devono avere `Content-Type: application/json` e un `Origin` uguale a quello del server di sviluppo: così un sito qualsiasi aperto nel browser non può mandare POST a localhost;
  - slug validati con la regex del §4 prima di diventare percorsi di file.

---

## 10. Skill di Claude Code (in `.claude/skills/`)

### 10.1 `/add-episode <url>`

- Usa `pnpm episode add <url>` (stessa logica di ingest della UI); per l'import iniziale accetta una data di aggiunta (`--added-at`).
- Se non trova la trascrizione, **chiede** se lanciare Whisper; se sì, lo esegue **in background** (~25 min) e avvisa a fine lavoro.

### 10.2 `/podcast-notes <slug>`

- Contesto: l'episodio è stato ascoltato; la skill carica la trascrizione **intera** tramite `pnpm transcript export <slug>` (markdown compatto, §4.4, con il `timebase` nell'intestazione) — niente RAG.
- Conduce un'esplorazione a **domande e risposte** per approfondire e riflettere su quanto detto, citando i timestamp. Citazioni brevi (meno di 20 parole), il resto parafrasato (§5.1).
- Alla fine prepara il **formato fisso** da inserire nel JSON: summary, notes, tags (riusando quelli di `pnpm tags`), ospiti se mancanti. Mostra la **bozza** e salva con `pnpm episode save --expected-updated-at` **solo dopo il mio OK**.
- La **conversazione** non la produce la skill: la esporto (es. `/export` di Claude Code) e la incollo io dalla UI locale. Gli estratti della trascrizione eventualmente inclusi nell'export vengono rimossi al salvataggio (§5.1).

### 10.3 `AGENTS.md`

Documenta: struttura dei dati, unico punto di scrittura (CLI), formato di output, convenzioni di lingua, `pnpm tags` per i tag esistenti, regola sulle citazioni (§4.5).

---

## 11. Deploy

- **GitHub Action** a ogni push su `main`: lint, test, build Vite → copia di `index.html` per ogni episodio e in `404.html` → pubblicazione su GitHub Pages.
- Controlli che fanno fallire la build:
  - un file tracciato in `data/transcripts/`, `data/audio/` o `data/cache/`;
  - codice delle funzioni locali nel bundle (ricerca di marcatori come le chiamate a `/api/`).
- Nel bundle finiscono solo dati versionati e UI in sola lettura; server, CLI, transcriber e funzioni dev restano fuori. Le trascrizioni non sono nel repo e quindi non possono finire online come file.
- Che una trascrizione rientri dentro conversazioni o notes lo impedisce il controllo in `core` (§5.1): la CI non può ripeterlo, perché non ha le trascrizioni.

---

## 12. Fuori dalla v1

- Stato "da ascoltare" (si aggiungerà un campo `status`).
- Ricerca full-text o semantica (embeddings) nelle trascrizioni; RAG per domande trasversali a più episodi.
- Lancio di Whisper dalla UI con avanzamento.
- Scrittura da remoto (GitHub Action + token, o Supabase).
- Trascrizioni sul sito, hosting privato.
- Fallback YouTube per le trascrizioni Lex/Huberman mancanti (si usa Whisper).
- Estrazione automatica delle conversazioni dai log di Claude Code.

---

## 13. Dettagli non discussi — default proposti per l'implementazione

Non decisi esplicitamente nella sessione; si adottano questi default salvo diversa indicazione:

- **Slug episodio**: `<show>-<titolo-in-kebab-case>` troncato, univoco, conforme alla regex del §4; usato per nome file e URL.
- **Duplicati**: aggiungere un URL già presente (stesso link o stesso `youtubeId`) non crea un secondo episodio, segnala quello esistente.
- **Show "generici"**: uno show per canale YouTube; feed iTunes solo dopo conferma (§4.1).
- **Editor dei tag**: input con suggerimenti dai tag esistenti, per favorire il riuso.
- **Stato vuoto**: home con invito ad aggiungere il primo episodio (solo in dev).
- **Tema chiaro/scuro**: segue il sistema.
- **Runtime**: Node LTS + `tsx` (§3).

---

## 14. Rischi noti

- **PatrykWajs/Huberman-Lab-Wiki** è un repo di terzi poco diffuso (5 stelle): può fermarsi. Mitigazione: clone locale in cache (resta anche se il repo sparisce); fallback Whisper; `transcriptSource` permette di ritrascrivere selettivamente.
- **YouTube** può bloccare `yt-dlp`: aggiornarlo o usare i cookie del browser; il feed RSS fa da ripiego, con timestamp non allineati al video (`timebase: feed`).
- Tempi e qualità di **`diarize`** non verificati in modo indipendente; pyannote come piano B. L'euristica "primo che parla = host" sbaglia con i cold open.
- Le stime di velocità di Whisper su CPU vanno misurate nella prova iniziale (§15, fase 2).
- Copertura limitata: trascrizioni Lex ~123/500 (il feed RSS di Lex, prima ~38 episodi, ora ne ha ~503).
- Struttura HTML di lexfridman.com può cambiare (parser da aggiornare); i test con fixture ridotte se ne accorgono.
- **Trascrizioni che rientrano** in conversazioni o notes: mitigato dal controllo del §5.1. Restano possibili citazioni sotto le 20 parole e parafrasi, accettabili.
- **Feed sbagliato per uno show generico** (abbinamento iTunes): mitigato dalla conferma (§4.1) e dall'URL dell'audio registrato nella trascrizione (§7.2).

---

## 15. Fasi di implementazione

Ogni fase ha un criterio di completamento verificabile.

1. **Fondamenta** — setup Vite + React + Tailwind + shadcn, TypeScript (Node LTS, `tsx`), Hono montato con `@hono/vite-dev-server`, Zod, MiniSearch, Vitest; `.gitignore` per `data/transcripts/`, `data/audio/`, `data/cache/` (già aggiunto); script pnpm (`dev`, `build`, `test`, `episode`, `tags`, `transcript`, `transcribe`); integrazione oxlint/oxfmt.
   _Fatto quando_: `pnpm dev` avvia Vite con Hono montato e un endpoint `/api` di prova risponde; lint, format e test passano.
2. **Prova del transcriber** — script minimo uv con faster-whisper `small.en` + `diarize` su ~20 minuti di audio reale, preferibilmente di un episodio Lex con trascrizione ufficiale, per confrontare la qualità. È l'incognita più grossa del piano: va misurata prima di costruirci sopra.
   _Fatto quando_: tempi (trascrizione e diarizzazione) e qualità sono annotati in §7, ed è deciso se §7 va cambiato.
3. **Core e dati** — schema Zod di show / episodio / conversazioni / trascrizione (con `extra`, `guests`, `number`, `publishedAt`, `transcriptTimebase`, slug validati); lettura/scrittura; CLI `episode save` con la semantica del §5; controllo delle trascrizioni (§5.1); `pnpm tags`; show Lex e Huberman inseriti a mano (feed + immagine); test con fixture ridotte.
   _Fatto quando_: un input valido viene salvato, uno invalido rifiutato con errore chiaro; i campi presenti sono sovrascritti e quelli assenti restano invariati; lo stesso input salvato due volte non duplica le conversazioni; un `updatedAt` vecchio viene rifiutato; un estratto di trascrizione viene rimosso da una conversazione e rifiutato nelle notes.
4. **Ingest** — riconoscimento URL (Lex anche da YouTube, via `author_url`); Lex (HTML ufficiale, `youtubeId` dai link, mappa in cache); Huberman (clone PatrykWajs + indice); YouTube generico (oEmbed); `publishedAt`, numero, ospiti; creazione show (iTunes Search con conferma, immagine in `public/shows/`); gestione duplicati; CLI `episode add` con `--added-at`.
   _Fatto quando_: un URL Lex recente, lo stesso episodio Lex dato come URL YouTube, uno Huberman e uno YouTube generico producono episodio + (dove disponibile) trascrizione nel formato unico; un URL senza trascrizione produce l'episodio con il badge.
5. **Frontend in sola lettura** — lista densa con miniature (`hqdefault`), filtri show/tag, ricerca MiniSearch, dettaglio con summary/notes (timestamp linkati solo con `timebase: youtube`) e conversazioni richiudibili caricate a richiesta; `index.html` per episodio + `404.html`; `base` per Pages; UI in italiano; design curato.
   _Fatto quando_: la build di produzione funziona servita sotto `/e-podcasts/`, un link diretto a un episodio risponde con status 200 e le conversazioni stanno in chunk separati.
6. **Deploy** — GitHub Action → GitHub Pages con lint, test e controlli del §11; repo pubblico. Anticipato rispetto alla prima stesura: costa poco e scopre presto i problemi di `base` e Pages.
   _Fatto quando_: il sito è online, e la CI fallisce se si traccia un file in `data/transcripts/` o se il bundle contiene codice delle funzioni locali.
7. **Server e funzioni locali** — export markdown compatto (`pnpm transcript export`); endpoint Hono con le protezioni del §9; form di aggiunta, editor (ospiti compresi), aggiungi conversazione, copia per l'agente, correzione speaker, badge + comando di trascrizione; tutto solo in dev.
   _Fatto quando_: da UI si aggiunge un episodio e se ne modificano gli appunti senza toccare file a mano; un salvataggio in conflitto viene segnalato senza perdere il testo; una POST da un'altra origine viene rifiutata.
8. **Transcriber** — progetto uv, partendo dalla prova della fase 2; catena audio `yt-dlp` → feed RSS → errore, con `timebase` e `audio` registrati; blocchi da 10 min con ripresa; faster-whisper `small.en` (flag `--model`) con timestamp per parola e `initial_prompt`; diarize sull'audio intero (`--num-speakers`, flag per pyannote); segmenti spezzati al cambio di speaker; euristica host/ospiti; output nel formato unico; cancellazione audio (`--keep-audio`).
   _Fatto quando_: un episodio reale da ~2 h viene trascritto entro ~30 min (tempo misurato e annotato qui); interrompere e rilanciare riprende dal blocco successivo senza rifare la diarizzazione; gli speaker restano coerenti per tutto l'episodio.
9. **Skill e AGENTS.md** — `/add-episode` (con Whisper in background su conferma), `/podcast-notes` (export intero, Q&A, bozza, salvataggio con `--expected-updated-at` dopo OK), convenzioni, `pnpm tags` e regola sulle citazioni in `AGENTS.md`.
   _Fatto quando_: un ciclo completo aggiungi → discuti → salva → incolla la conversazione funziona su un episodio reale, e la conversazione salvata non contiene estratti della trascrizione.

---

## 16. Registro delle decisioni

| #   | Tema                             | Decisione                                                                                                          | Alternative scartate                                                          |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | Utenti                           | Solo io, strumento personale                                                                                       | Multiutente                                                                   |
| 2   | Contenuto                        | Podcast ascoltati, Lex + Huberman + qualsiasi YouTube                                                              | Solo due show                                                                 |
| 3   | Persistenza                      | File JSON in git, scritture solo in locale                                                                         | Supabase, DB locale                                                           |
| 4   | Hosting                          | GitHub Pages pubblico, sola lettura                                                                                | Cloudflare Pages + Access, solo locale                                        |
| 5   | Repo                             | Pubblico (requisito Pages su piano Free)                                                                           | Privato                                                                       |
| 6   | Trascrizioni                     | Gitignored, solo locali, mai sul sito                                                                              | Pubblicate                                                                    |
| 7   | Frontend                         | React + Vite + Tailwind + shadcn                                                                                   | Next.js                                                                       |
| 8   | Scritture _(rivista)_            | Server Hono locale montato in Vite (`@hono/vite-dev-server`), non deployato                                        | API Next, GitHub API da browser, processo Hono separato con proxy             |
| 9   | Struttura                        | Un solo pacchetto pnpm                                                                                             | Monorepo/workspace                                                            |
| 10  | Validazione                      | Zod + unico punto di scrittura (CLI/core)                                                                          | Modifica manuale dei JSON                                                     |
| 11  | File dati _(rivista)_            | Un JSON per show/episodio/trascrizione; conversazioni in un file separato per episodio                             | Unico `episodes.json`, conversazioni dentro l'episodio                        |
| 12  | Appunti                          | `summary` + `notes` + `conversations[]`                                                                            | Commenti datati                                                               |
| 13  | Conversazioni _(rivista)_        | `{date, agent, markdown}`, pubbliche, incollate da me, ripulite dagli estratti della trascrizione                  | Messaggi strutturati, estrazione dai log                                      |
| 14  | Date _(rivista)_                 | `addedAt` automatica + `updatedAt` + `publishedAt`; `--added-at` solo da CLI per l'import iniziale                 | Data di ascolto modificabile dalla UI                                         |
| 15  | Stato                            | Nessuno (tutto "ascoltato")                                                                                        | `da-ascoltare` / `ascoltato`                                                  |
| 16  | Tag _(rivista)_                  | Piatti, inglese minuscolo, proposti dall'agente, riuso via `pnpm tags`                                             | Gerarchia, tag manuali, elenco copiato in `AGENTS.md`                         |
| 17  | Lingua                           | UI italiano, appunti liberi                                                                                        | —                                                                             |
| 18  | Ricerca                          | MiniSearch su metadati + appunti                                                                                   | Pagefind, ricerca nelle trascrizioni, semantica                               |
| 19  | Lista                            | Densa, titolo in grande, miniature                                                                                 | Card                                                                          |
| 20  | Dettaglio                        | Nessuna trascrizione visibile                                                                                      | Trascrizione con timestamp                                                    |
| 21  | Immagini _(rivista)_             | Miniatura YouTube linkata (`hqdefault`; `maxresdefault` con ripiego nel dettaglio); immagine show salvata nel repo | Immagini episodio nel repo, solo `maxresdefault`                              |
| 22  | Routing _(rivista)_              | URL puliti + `index.html` per episodio + `404.html` di ripiego                                                     | Hash router, solo `404.html`                                                  |
| 23  | Dati nel frontend _(rivista)_    | `import.meta.glob` nel bundle, conversazioni a richiesta; server solo per scrivere                                 | Fetch da API, tutto nel bundle iniziale                                       |
| 24  | Fonte Lex                        | HTML ufficiale `-transcript`                                                                                       | Sottotitoli YouTube                                                           |
| 25  | Fonte Huberman _(rivista)_       | PatrykWajs/Huberman-Lab-Wiki, clone locale                                                                         | Pagine Premium (paywall), sottotitoli YouTube nostri, lettura via API GitHub  |
| 26  | Formato trascrizione _(rivista)_ | Unico, segmenti `{speaker?, start, text}` + capitoli + `timebase`                                                  | Per fonte                                                                     |
| 27  | Agente e trascrizione            | Intera, markdown compatto, niente RAG né tool                                                                      | RAG, tool di navigazione                                                      |
| 28  | Audio _(rivista)_                | `yt-dlp` → feed RSS → errore; cancellato dopo l'uso                                                                | Feed prima di `yt-dlp`, solo YouTube, conservare l'audio                      |
| 29  | Feed show nuovi                  | API iTunes Search                                                                                                  | Inserimento manuale                                                           |
| 30  | ASR                              | faster-whisper `small.en` int8 su CPU, blocchi da 10 min                                                           | `large-v3-turbo`, benchmark comparativo                                       |
| 31  | Diarizzazione _(rivista)_        | `diarize` sull'audio intero, `--num-speakers` (default 1 + ospiti), primo = host                                   | Diarizzazione a blocchi, 2 speaker fissi, pyannote (piano B), VibeVoice, NeMo |
| 32  | Lancio trascrizione              | CLI (o skill in background)                                                                                        | Pulsante UI                                                                   |
| 33  | Ingest                           | Form UI locale + CLI + skill, stessa logica                                                                        | Solo UI                                                                       |
| 34  | Skill                            | `/add-episode` e `/podcast-notes`, salvataggio dopo OK                                                             | Una sola skill                                                                |
| 35  | Deploy                           | GitHub Action su push a `main`                                                                                     | Deploy manuale                                                                |
| 36  | Ospiti                           | `guests: string[]`, anche vuoto                                                                                    | Campo singolo `ospite`                                                        |
| 37  | Numero episodio                  | `number` opzionale, usato negli abbinamenti                                                                        | Abbinamento solo per titolo                                                   |
| 38  | Timestamp                        | `timebase` youtube/feed; link YouTube solo con `youtube`                                                           | Link a YouTube sempre                                                         |
| 39  | Lex da YouTube                   | Riconosciuto da `author_url`, mappa `youtubeId` → pagina in cache                                                  | Solo URL `lexfridman.com`                                                     |
| 40  | Semantica di `save`              | Campi assenti invariati, conversazioni deduplicate, controllo su `updatedAt`                                       | Sovrascrittura completa                                                       |
| 41  | Protezione trascrizioni          | Controllo in `core`: sequenze di ≥ 20 parole rimosse dalle conversazioni, rifiutate in summary/notes               | Solo `.gitignore`                                                             |
| 42  | Show nuovi                       | Feed iTunes confermato a mano                                                                                      | Feed accettato in automatico                                                  |
| 43  | Test                             | Vitest, fixture ridotte o sintetiche                                                                               | Nessun test, fixture complete                                                 |
| 44  | Sicurezza server                 | Solo localhost, JSON + controllo `Origin`, slug validati                                                           | Nessun controllo                                                              |
| 45  | Runtime                          | Node LTS + `tsx`                                                                                                   | Non specificato                                                               |
| 46  | Qualità ASR                      | Timestamp per parola, `initial_prompt` con i nomi                                                                  | —                                                                             |
| 47  | Ordine delle fasi                | Prova del transcriber subito; deploy dopo il frontend                                                              | Transcriber e deploy alla fine                                                |
| 48  | CI                               | Lint, test, controlli su file tracciati e bundle                                                                   | Solo build                                                                    |
