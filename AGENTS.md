# e-hub

Una sola app React (Vite) per libreria di ebook, podcast, note ed esplorazioni. Monorepo pnpm: la mappa dei pacchetti è in [docs/struttura.md](docs/struttura.md), l'indice dei documenti in [docs/README.md](docs/README.md). Comandi in `package.json` (radice e pacchetti); i testi della UI e i documenti sono in italiano.

## Dove guardare

| Se lavori su… | Leggi prima | Codice da cui partire |
| --- | --- | --- |
| Libri, upload, `elib` (import, sync, summarize, text) | [packages/library/docs/PLAN.md](packages/library/docs/PLAN.md) | `packages/library/src/node/cli/commands/`, `src/node/services/` |
| Kobo (SSH, KEPUB, sidecar, sottolineature) | [packages/library/docs/kobo-ssh-migration.md](packages/library/docs/kobo-ssh-migration.md) | `packages/library/src/node/kobo/` (`sync.ts`, `highlights.ts`) |
| Pagina del libro, sito pubblico | [docs/struttura.md](docs/struttura.md) | `packages/library/src/web/routes/book-page.tsx`, `src/node/site-data/build.ts` |
| Chat AI: prompt, tool, note dalla chat, Appunti, Feel rich | [docs/chat.md](docs/chat.md) | `packages/chat/src/server/app.ts`, `packages/library/src/node/chat/{prompt,tools}.ts`, `packages/chat/src/web/chat-panel.tsx` |
| Esplorazioni (triage di libri prima di leggerli) | skill `explore` ([SKILL.md](.claude/skills/explore/SKILL.md)), [docs/esplorazioni.md](docs/esplorazioni.md) | `packages/explore/` |
| Podcast | [packages/podcasts/docs/DESIGN.md](packages/podcasts/docs/DESIGN.md) | `packages/podcasts/src/` |
| Note (Markdown, thread, pagina Note) | — | `packages/notes/src/` (`markdown.tsx`, `note-card.tsx`, `store.ts`) |
| Componenti condivisi, tema | — | `packages/ui/src/` (shadcn/ui + Tailwind) |

Quando l'utente vuole esplorare un tema nei suoi libri o decidere cosa leggere, usa la skill `explore`: lavora sugli stessi file della chat dell'app.

## Regole che il codice non dice

- **Il repo è pubblico** e `packages/*/data` viene pubblicato col sito. Nei dati vanno solo parole dell'utente o del modello e citazioni di al massimo due frasi. EPUB e testo dei libri restano nella cache `~/.cache/e-library`; token e chiavi solo in `.env.local`.
- **Dati attraverso UI o CLI** (`pnpm --filter @ehub/library elib …`, `pnpm --silent explore …`): validano con Zod. I file JSON si leggono liberamente, si scrivono con questi strumenti.
- **Il Kobo non ha cestino.** Le cancellazioni (`elib sync --prune`, delete di un libro) sono irreversibili: falle solo su richiesta esplicita, dopo un `--dry-run`. Il Kobo spesso dorme: un `listing-failed` o un timeout SSH vuol dire "spento", non "rotto".
- **Chat AI**: parla con il router freeway (endpoint e token in `.env.local`, il token non si stampa). Le quote gratuite finiscono presto: nei test si usa il mock `@ehub/chat/testing`, e le chiamate vere solo per una verifica finale.
- **Server di scrittura solo in dev**: i server Hono (`apps/web/server/*-dev.ts`) esistono con `pnpm dev` e non entrano nella build statica. Per l'anteprima c'è la configurazione "e-hub dev" in `.claude/launch.json` (porta 5173).
- **Stack UI**: React + Tailwind CSS + shadcn/ui, componenti condivisi in `packages/ui`.

## Verifica

Prima di dire che è fatto: `pnpm typecheck`, `pnpm test` e, se tocchi il web, `pnpm build`. Un solo pacchetto: `pnpm exec vitest run` dalla sua cartella. Per i cambi visibili, controlla la pagina con `pnpm dev`. Commit solo quando l'utente lo chiede.
