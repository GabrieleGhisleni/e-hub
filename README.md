# e-hub

Una sola app React per la mia **libreria di ebook**, i **podcast ascoltati** e le **note** su entrambi, con lo stesso stile e la stessa navigazione.

Sito pubblicato su GitHub Pages: https://gabrieleghisleni.github.io/e-hub/

Il sito pubblicato è in sola lettura. Aggiungere libri, podcast e note si fa solo in locale (`pnpm dev`), poi si fa commit dei file in `packages/*/data` e push: il deploy è automatico.

## Avvio rapido

Servono Node 24 e pnpm 11.

```bash
pnpm install
pnpm dev
```

L'app gira su http://127.0.0.1:5173.

## Comandi

| Comando          | Cosa fa                                          |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | App + server locali di scrittura (libreria, note, podcast) |
| `pnpm build`     | Build statica in `apps/web/dist`                 |
| `pnpm preview`   | Anteprima della build                            |
| `pnpm typecheck` | Typecheck di tutti i pacchetti                   |
| `pnpm test`      | Test di tutti i pacchetti                        |

Le stesse cose, più i comandi per i log del Pi e per `elib db`, sono scorciatoie del [Makefile](Makefile): `make help` le elenca.

| Scorciatoia | Cosa fa |
| --- | --- |
| `make check` | Typecheck + test + build, prima di un commit |
| `make db-status` / `make db-sync` / `make db-push` | Confronto locale ↔ account, anteprima, allineamento |
| `make logs` / `make logs-errors` / `make status` | Log in diretta, errori dell'ultima ora, stato di `ehub-api` sul Pi |
| `make health API_URL=https://…` | Controlla `/api/health` |

## CLI `elib`

`elib` non è un comando globale: si lancia dalla radice del repo con pnpm. Per scriverlo come `elib`, aggiungi in `~/.zshrc`: `alias elib='pnpm --dir ~/projects/e-hub --filter @ehub/library elib'`.

```bash
pnpm --filter @ehub/library elib <comando> [opzioni]
pnpm --filter @ehub/library elib --help          # elenco dei comandi
```

| Comando | Cosa fa |
| --- | --- |
| `import <cartella> [--dry-run] [--limit n] [--openlibrary]` | Importa gli `*.epub` della cartella (ricorsivo) in "Da smistare"; i `*.kepub.epub` si saltano |
| `sync [--dry-run] [--prune] [--no-highlights]` | Allinea il Kobo al repo e riporta le sottolineature. `--prune` cancella i file orfani dal Kobo (irreversibile, prima `--dry-run`) |
| `summarize [id] [--missing] [--lang it] [--force]` | Scrive `summary.json` con l'LLM, per un libro o per tutti quelli senza |
| `text <id> [--force]` | Estrae il testo del libro in Markdown, un file per capitolo (cache locale) |
| `validate [--json]` | Controlla `data/` (schemi, argomenti, file ammessi) |

Gli ID dei libri sono di 8 caratteri. Il Kobo spesso dorme: un timeout SSH vuol dire "spento".

## Aggiungere un libro

Si fa in locale, con `pnpm dev`:

1. **Singolo libro:** carica l'EPUB dal form di upload, correggi i metadati, scegli argomento, tag e copertina.
2. **Più libri:** `pnpm --filter @ehub/library elib import <cartella> [--dry-run]`. I libri finiscono in "Da smistare" e li classifichi dalla UI.
3. Poi commit e push di `packages/library/data`:

```bash
git add packages/library/data
git commit -m "Aggiunge libro: <titolo>"
git push
```

Gli EPUB non si committano mai: restano nella cache locale (`~/.cache/e-library`, da tenere in backup) e il KEPUB va sul Kobo via SSH (Wi-Fi). Servono `kepubify` e la chiave SSH del Kobo; dettagli in [kobo-ssh-migration.md](packages/library/docs/kobo-ssh-migration.md). `elib sync` allinea il Kobo quando era spento.

## Sottolineature dal Kobo

`elib sync` riporta anche le sottolineature fatte sul Kobo con KOReader: le legge da `<libro>.kepub.sdr/metadata.epub.lua` (sul Kobo non scrive nulla) e le salva in `packages/library/data/books/<id>/highlights.json`, nell'ordine del libro, con capitolo, pagina e l'eventuale commento. Nella pagina del libro compaiono nel riquadro "Sottolineature", raggruppate per capitolo.

```bash
pnpm --filter @ehub/library elib sync --dry-run   # cosa cambierebbe
pnpm --filter @ehub/library elib sync             # allinea il Kobo e riporta le sottolineature
```

Una sottolineatura cancellata sul Kobo sparisce anche dal file. Se però il Kobo non ne ha più nessuna per un libro che ne aveva, quelle salvate restano. `--no-highlights` salta questo passo.

## Chat con l'AI

Solo in locale (`pnpm dev`): pulsante "Chatta" nella pagina di un libro, di un episodio o di un'esplorazione. Parla con un endpoint OpenAI-compatibile (il router freeway) configurato in `.env.local`; le variabili sono in [.env.example](.env.example) e il funzionamento in [docs/chat.md](docs/chat.md).

- **Salva come nota**: sotto ogni risposta. La nota tiene il Markdown della risposta.
- **Appunti**: interruttore nel campo di testo, ricordato per libro. Le risposte arrivano già scritte come note (titolo in grassetto, prosa breve, `(cap. N)`); con "Aggiungi alla bozza" le raccogli in una bozza a lato, la rivedi (modifica, ordina, togli) e la salvi come una nota sola.
- **Feel rich**: interruttore accanto ad "Appunti". La domanda va al modello più potente (`EHUB_AI_RICH_MODEL`, default `gpt-6-luna`) invece che a `smart`. Non viene ricordato: si spegne ricaricando la pagina.
- **Ingrandisci**: la chat diventa una finestra centrata con il testo più grande.

## Log del servizio

**In locale** (`pnpm dev`): i log dei server Hono escono nel terminale dove gira `pnpm dev`. Dall'app, *Impostazioni → Stato dei servizi* mostra in un colpo solo backend, database, AI e Z-Library, con il motivo dell'errore.

**Sul Raspberry Pi** (API hosted, unità systemd `ehub-api`):

```bash
alias rpi="ssh -i ~/.ssh/id_ed25519_py ggabry@100.84.50.10"
rpi 'journalctl -u ehub-api -f'                    # in diretta (Ctrl-C per uscire)
rpi 'journalctl -u ehub-api -n 200 --no-pager'     # ultime 200 righe
rpi 'journalctl -u ehub-api --since "1 hour ago" -p err'   # solo errori dell'ultima ora
rpi 'systemctl status ehub-api'                    # attivo? riavvii recenti?
rpi 'journalctl -u ehub-update --no-pager -n 50'   # aggiornamenti automatici da GitHub
curl -s https://<api>/api/health                   # {"ok":true} se risponde
```

All'avvio il server scrive su cosa è montato (`Turso + R2` o `file locali`). Un `listing-failed` o un timeout SSH dal Kobo non è un guasto: vuol dire che è spento.

## Libreria locale e account (`elib db`)

I libri aggiunti in locale (`pnpm dev`) e quelli aggiunti dall'app hosted vivono in posti diversi: file in `packages/library/data` + EPUB nella cache da una parte, database Turso + R2 dall'altra. `elib db` li confronta e riempie i buchi in entrambe le direzioni. Servono `EHUB_API_URL` e `EHUB_API_TOKEN` (il token si copia da Impostazioni dopo il login; vanno bene in `.env.local`).

```bash
pnpm --filter @ehub/library elib db status                   # solo locale / solo account / diversi
pnpm --filter @ehub/library elib db sync                     # anteprima del piano
pnpm --filter @ehub/library elib db sync --apply             # copia ciò che manca da una parte all'altra
pnpm --filter @ehub/library elib db sync --apply --prefer local   # per i file diversi vince il locale (o `remote`)
```

Senza `--prefer`, i file presenti da entrambe le parti ma diversi non si toccano. `--epubs` confronta anche gli EPUB di ogni libro (scarica quelli dell'account: lento); per un libro che manca da una parte l'EPUB viaggia comunque.

## Deploy

Ogni push su `main` esegue [`.github/workflows/pages.yml`](.github/workflows/pages.yml): build con `BASE_PATH=/<nome-repo>/` e pubblicazione su GitHub Pages.

## Documentazione

Vedi [docs/](docs/README.md), a partire dalla [struttura del repo](docs/struttura.md).
