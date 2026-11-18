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

## Deploy

Ogni push su `main` esegue [`.github/workflows/pages.yml`](.github/workflows/pages.yml): build con `BASE_PATH=/<nome-repo>/` e pubblicazione su GitHub Pages.

## Documentazione

Vedi [docs/](docs/README.md), a partire dalla [struttura del repo](docs/struttura.md).
