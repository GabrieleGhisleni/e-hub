# e-hub

Una sola app React (Vite) per libreria di ebook, podcast, note ed esplorazioni. Monorepo pnpm: la mappa dei pacchetti è in [docs/struttura.md](docs/struttura.md), l'indice dei documenti in [docs/README.md](docs/README.md). Comandi in `package.json` (radice e pacchetti); i testi della UI e i documenti sono in italiano.

## Come gira

Un solo modo, in locale e in produzione ([docs/hosting.md](docs/hosting.md)): sito statico su **GitHub Pages** → **API Hono unica** (`apps/api`) → **Turso** (documenti) e **Cloudflare R2** (EPUB, copertine). In produzione l'API sta sul **Raspberry Pi** dietro un tunnel. Login Google gestito dall'API, **multi-utente con allowlist** (`ALLOWED_EMAILS`): ognuno vede solo i propri dati. Chi non è loggato vede la **demo** (`demo/seed/`, utente riservato `demo`, solo letture).

**Non esistono dati nel repo né una modalità su file.** `pnpm dev` avvia l'API sul laptop (porta 8788) **collegata al Turso vero**, con le chiavi di `.env.local`, e Vite (porta 5173) che le inoltra `/api` e `/auth`; il sito entra da solo come proprietario (`API_DEV_OWNER_EMAIL`, `POST /auth/dev`, accettato solo su loopback e senza header di proxy). Quindi **ogni scrittura in sviluppo è sui dati reali**, gli stessi che si vedono online. Le CLI (`elib`, `explore`, `episode`, `tags`, `transcribe`, `transcript`) si collegano direttamente a Turso/R2 come `EHUB_OWNER_EMAIL`.

Deploy: ogni push su `main` fa partire due workflow (`.github/workflows/`): `pages.yml` pubblica il sito, `api-release.yml` costruisce il bundle dell'API e lo pubblica come release `api-latest`; il Pi la scarica da solo ogni 2 minuti (`deploy/pi/ehub-update.sh`). Quindi **un push su `main` aggiorna la produzione**. Le migrazioni SQL sono in `turso/migrations/` (`pnpm --filter @ehub/store db:migrate`).

## Dove guardare

| Se lavori su… | Leggi prima | Codice da cui partire |
| --- | --- | --- |
| Hosting, utenti, demo, Pi, migrazione | [docs/hosting.md](docs/hosting.md) | `apps/api/src/` (`app.ts`, `auth.ts`, `store-routes.ts`), `packages/store/src/`, `deploy/pi/` |
| Libri, upload, `elib` (import, sync, summarize, text) | [packages/library/docs/PLAN.md](packages/library/docs/PLAN.md) | `packages/library/src/node/cli/commands/`, `src/node/services/` |
| Z-Library / LibGen (ricerca e download) | — | `packages/library/src/node/zlibrary/` |
| Kobo (SSH, KEPUB, coda, sidecar, sottolineature) | [packages/library/docs/kobo-ssh-migration.md](packages/library/docs/kobo-ssh-migration.md) | `packages/library/src/node/kobo/` (`sync.ts`, `highlights.ts`) |
| Pagina del libro | [docs/struttura.md](docs/struttura.md) | `packages/library/src/web/routes/book-page.tsx` |
| Chat AI: prompt, tool, note dalla chat, Appunti, Feel rich | [docs/chat.md](docs/chat.md) | `packages/chat/src/server/app.ts`, `packages/library/src/node/chat/{prompt,tools}.ts`, `packages/chat/src/web/chat-panel.tsx` |
| Esplorazioni (triage di libri prima di leggerli) | skill `explore` ([SKILL.md](.claude/skills/explore/SKILL.md)), [docs/esplorazioni.md](docs/esplorazioni.md) | `packages/explore/` |
| Podcast e trascrizioni (Groq) | [packages/podcasts/docs/DESIGN.md](packages/podcasts/docs/DESIGN.md), [docs/tasks/podcast-transcriptions.md](docs/tasks/podcast-transcriptions.md) | `packages/podcasts/src/` |
| Note (Markdown, thread, pagina Note) | — | `packages/notes/src/` (`markdown.tsx`, `note-card.tsx`, `store.ts`) |
| Componenti condivisi, tema | — | `packages/ui/src/` (shadcn/ui + Tailwind) |

Quando l'utente vuole esplorare un tema nei suoi libri o decidere cosa leggere, usa la skill `explore`: lavora sugli stessi dati della chat dell'app (la CLI `explore` si collega direttamente a Turso).

## Regole che il codice non dice

- **Il repo è pubblico.** Nei dati (che stanno in Turso, non nel repo) vanno solo parole dell'utente o del modello e citazioni di al massimo due frasi. EPUB e testo dei libri restano su R2 e nella cache `~/.cache/e-library` (laptop) o del Pi, mai nel repo. Token e chiavi solo in `.env.local` (laptop) e `/etc/ehub/env` (Pi, vedi `deploy/pi/env.example`): non stamparli, non committarli. `packages/podcasts/data/{transcripts,audio,cache}` è solo cache locale, gitignored.
- **Isolamento per utente**: ogni lettura/scrittura passa da `forUser(userId)` / `runAsUser` nello strato `@ehub/store`. Non aggirarlo con query o percorsi diretti; i test non devono richiedere un DB (ci sono le implementazioni in memoria).
- **Dati attraverso UI o CLI** (`pnpm --filter @ehub/library elib …`, `pnpm --silent explore …`): validano con Zod. Non si scrive in Turso a mano con SQL: si passa da UI o CLI. Per guardare i dati: le CLI (`explore list`, `explore library`, `episode`…) o l'app.
- **Il Kobo non ha cestino.** Le cancellazioni (`elib sync --prune`, delete di un libro) sono irreversibili: falle solo su richiesta esplicita, dopo un `--dry-run`. Il Kobo spesso dorme: un `listing-failed` o un timeout SSH vuol dire "spento", non "rotto". Lo sync è a mano («Sincronizza ora»), con coda `kobo_queue`; lo usa solo il proprietario (`KOBO_OWNER_EMAIL`).
- **Chat AI**: parla con il router freeway (endpoint e token in `.env.local`, il token non si stampa). Le quote gratuite finiscono presto e sono condivise tra gli utenti: nei test si usa il mock `@ehub/chat/testing`, le chiamate vere solo per una verifica finale.
- **Z-Library / LibGen**: Z-Library è per utente (sessione in cache, mai la password); LibGen è il fallback. I test non toccano la rete: il client è iniettabile in `createApp`.
- **Anteprima**: la configurazione "e-hub dev" in `.claude/launch.json` (porta 5173) avvia `pnpm dev`. Se la 5173 è occupata da un altro `pnpm dev`, `WEB_PORT=5199 PORT=8799 pnpm dev` usa altre porte. `API_DEV_OWNER_EMAIL` non va mai impostata sul Pi (sulla macchina c'è un tunnel che arriva su loopback).
- **Test**: nessun test richiede Turso o rete: usano `MemoryDocClient`, i mount in memoria e i mock (`@ehub/chat/testing`). Le CLI dei podcast nei test girano su una cartella temporanea con `E_PODCASTS_DATA_DIR`.
- **Stack UI**: React + Tailwind CSS + shadcn/ui, componenti condivisi in `packages/ui`.

## Verifica

Prima di dire che è fatto: `pnpm typecheck`, `pnpm test` e, se tocchi il web, `pnpm build`. Un solo pacchetto: `pnpm exec vitest run` dalla sua cartella. Per i cambi visibili, controlla la pagina con `pnpm dev`. Commit solo quando l'utente lo chiede; ricorda che il push su `main` pubblica sito e API.
