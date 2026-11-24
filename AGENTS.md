# e-hub

Una sola app React (Vite) per libreria di ebook, podcast, note ed esplorazioni. Monorepo pnpm: la mappa dei pacchetti è in [docs/struttura.md](docs/struttura.md), l'indice dei documenti in [docs/README.md](docs/README.md). Comandi in `package.json` (radice e pacchetti); i testi della UI e i documenti sono in italiano.

## Come gira

Due modi, stesso codice:

- **Locale** (`pnpm dev`): Vite + i server Hono di dev (`apps/web/server/*-dev.ts`, server della libreria). Dati su file in `packages/*/data`, nessun login.
- **Hosted** (quello in produzione, [docs/hosting.md](docs/hosting.md)): sito statico su **GitHub Pages** (`build:hosted`) → **API Hono unica** (`apps/api`) sul **Raspberry Pi** dietro un tunnel → **Turso** (documenti) e **Cloudflare R2** (EPUB, copertine). Login Google gestito dall'API, **multi-utente con allowlist** (`ALLOWED_EMAILS`): ognuno vede solo i propri dati. Chi non è loggato vede la **demo** (`demo/seed/`, utente riservato `demo`, solo letture).

Deploy: ogni push su `main` fa partire due workflow (`.github/workflows/`): `pages.yml` pubblica il sito, `api-release.yml` costruisce il bundle dell'API e lo pubblica come release `api-latest`; il Pi la scarica da solo ogni 2 minuti (`deploy/pi/ehub-update.sh`). Quindi **un push su `main` aggiorna la produzione**. Le migrazioni SQL sono in `turso/migrations/`.

## Dove guardare

| Se lavori su… | Leggi prima | Codice da cui partire |
| --- | --- | --- |
| Hosting, utenti, demo, Pi, migrazione | [docs/hosting.md](docs/hosting.md) | `apps/api/src/` (`app.ts`, `auth.ts`, `store-routes.ts`), `packages/store/src/`, `deploy/pi/` |
| Libri, upload, `elib` (import, sync, summarize, text, db) | [packages/library/docs/PLAN.md](packages/library/docs/PLAN.md) | `packages/library/src/node/cli/commands/`, `src/node/services/` |
| Z-Library / LibGen (ricerca e download) | — | `packages/library/src/node/zlibrary/` |
| Kobo (SSH, KEPUB, coda, sidecar, sottolineature) | [packages/library/docs/kobo-ssh-migration.md](packages/library/docs/kobo-ssh-migration.md) | `packages/library/src/node/kobo/` (`sync.ts`, `highlights.ts`) |
| Pagina del libro | [docs/struttura.md](docs/struttura.md) | `packages/library/src/web/routes/book-page.tsx` |
| Chat AI: prompt, tool, note dalla chat, Appunti, Feel rich | [docs/chat.md](docs/chat.md) | `packages/chat/src/server/app.ts`, `packages/library/src/node/chat/{prompt,tools}.ts`, `packages/chat/src/web/chat-panel.tsx` |
| Esplorazioni (triage di libri prima di leggerli) | skill `explore` ([SKILL.md](.claude/skills/explore/SKILL.md)), [docs/esplorazioni.md](docs/esplorazioni.md) | `packages/explore/` |
| Podcast e trascrizioni (Groq) | [packages/podcasts/docs/DESIGN.md](packages/podcasts/docs/DESIGN.md), [docs/tasks/podcast-transcriptions.md](docs/tasks/podcast-transcriptions.md) | `packages/podcasts/src/` |
| Note (Markdown, thread, pagina Note) | — | `packages/notes/src/` (`markdown.tsx`, `note-card.tsx`, `store.ts`) |
| Componenti condivisi, tema | — | `packages/ui/src/` (shadcn/ui + Tailwind) |

Quando l'utente vuole esplorare un tema nei suoi libri o decidere cosa leggere, usa la skill `explore`: lavora sugli stessi dati della chat dell'app (in locale sui file, con `EHUB_API_URL` + `EHUB_API_TOKEN` sui dati hosted dell'utente).

## Regole che il codice non dice

- **Il repo è pubblico.** Nei dati vanno solo parole dell'utente o del modello e citazioni di al massimo due frasi. EPUB e testo dei libri restano nella cache `~/.cache/e-library` (locale) o su R2/cache del Pi, mai nel repo. Token e chiavi solo in `.env.local` (laptop) e `/etc/ehub/env` (Pi, vedi `deploy/pi/env.example`): non stamparli, non committarli.
- **`packages/*/data` è ancora in git** (migrazione verso Turso in corso, vedi hosting.md): nell'hosted la fonte dei dati è Turso, non quei file.
- **Isolamento per utente**: ogni lettura/scrittura passa da `forUser(userId)` / `runAsUser` nello strato `@ehub/store`. Non aggirarlo con query o percorsi diretti; i test non devono richiedere un DB (ci sono le implementazioni in memoria/file).
- **Dati attraverso UI o CLI** (`pnpm --filter @ehub/library elib …`, `pnpm --silent explore …`): validano con Zod. I file JSON si leggono liberamente, si scrivono con questi strumenti.
- **Il Kobo non ha cestino.** Le cancellazioni (`elib sync --prune`, delete di un libro) sono irreversibili: falle solo su richiesta esplicita, dopo un `--dry-run`. Il Kobo spesso dorme: un `listing-failed` o un timeout SSH vuol dire "spento", non "rotto". Lo sync è a mano («Sincronizza ora»), con coda `kobo_queue`; lo usa solo il proprietario (`KOBO_OWNER_EMAIL`).
- **Chat AI**: parla con il router freeway (endpoint e token in `.env.local`, il token non si stampa). Le quote gratuite finiscono presto e sono condivise tra gli utenti: nei test si usa il mock `@ehub/chat/testing`, le chiamate vere solo per una verifica finale.
- **Z-Library / LibGen**: Z-Library è per utente (sessione in cache, mai la password); LibGen è il fallback. I test non toccano la rete: il client è iniettabile in `createApp`.
- **Anteprima**: la configurazione "e-hub dev" in `.claude/launch.json` (porta 5173) avvia `pnpm dev`. Le scritture nel dev locale vanno su file; per provare l'hosted serve un'API (`API_LOCAL_DEV=1` solo su loopback).
- **Stack UI**: React + Tailwind CSS + shadcn/ui, componenti condivisi in `packages/ui`.

## Verifica

Prima di dire che è fatto: `pnpm typecheck`, `pnpm test` e, se tocchi il web, `pnpm build` (e `pnpm --filter @ehub/web build:hosted` se tocchi login, sessione o chiamate all'API). Un solo pacchetto: `pnpm exec vitest run` dalla sua cartella. Per i cambi visibili, controlla la pagina con `pnpm dev`. Commit solo quando l'utente lo chiede; ricorda che il push su `main` pubblica sito e API.
