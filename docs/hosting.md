# Hosting: e-hub fuori dal laptop

Stato: **in implementazione** (2026-11-18). Cambio di piano durante i lavori: Turso al posto di Supabase e Google OAuth gestito da Hono al posto di Supabase Auth; vedi «Stato delle fasi» in fondo. Oggi tutto gira sul laptop: i dati sono JSON in git, le scritture passano dai server Hono di dev e dalle CLI. Questo documento descrive dove va ogni pezzo quando l'app diventa hosted.

## Il quadro

```
     Browser (GitHub Pages: React/Vite statico)
                      │ HTTPS, sessione Google per le scritture
                      ▼
          ┌──────────────────────────┐   service key   ┌───────────────┐
          │  Raspberry Pi 3 (casa)   │◄───────────────►│     Turso     │
          │  Hono unico + freeway    │                 │ Postgres+Auth │
          │  kepubify, ffmpeg        │   S3 API        ├───────────────┤
          │  cache su disco          │◄───────────────►│ Cloudflare R2 │
          └────┬───────────────┬─────┘                 │ EPUB, backup  │
               │ SSH (LAN)     │ HTTPS                 └───────────────┘
               ▼               ▼
             Kobo        Groq Whisper
```

| Pezzo | Dove | Perché |
| --- | --- | --- |
| Frontend | **GitHub Pages** | Solo codice statico. Tutti i dati arrivano a runtime dall'API del Pi. |
| Database | **Turso** (libSQL/SQLite, piano gratuito) | Unica fonte dei dati: libri, podcast, note, esplorazioni, chat, coda del Kobo. |
| Login | **Google OAuth gestito dall'API Hono** | Un solo utente: email in allowlist. L'API emette un proprio token di sessione. |
| File | **Cloudflare R2**, bucket privato | EPUB (unica copia) e dump del DB. 10 GB gratis, niente costi di egress, API S3. |
| Backend | **Raspberry Pi 3** dietro un tunnel HTTPS | Unico punto d'accesso ai dati; l'unico che raggiunge il Kobo; freeway ci gira già. |
| Cache di lavoro | Disco del Pi | KEPUB, audio e trascrizioni dei podcast, testo dei libri: tutto ricostruibile. |
| Trascrizione | **Groq**, `whisper-large-v3-turbo` | Gratis (circa 8 h di audio al giorno); riserva: Cloudflare Workers AI. |

## Regole

- **Il frontend parla solo con il Pi.** Nessuna chiave del database nel browser, solo il token di sessione; nessuna policy da mantenere. Il Pi accede al DB con il token di Turso. Se il Pi è spento, il sito non mostra dati: è accettato.
- **Letture pubbliche, scritture autenticate.** Le rotte `GET` dell'API sono aperte; tutte le altre richiedono il token di sessione che l'API emette dopo il login con Google (PKCE, `apps/api/src/google.ts`) solo per le email in allowlist. Il token torna al sito nel frammento dell'URL (`#token=…`), vive una settimana ed è firmato con `SESSION_SECRET`.
- **Le chiavi stanno solo sul Pi**: token di Turso, segreto del client Google e `SESSION_SECRET`, chiavi R2, token di freeway e Groq, chiave SSH del Kobo. Le CLI del laptop (`elib`, `explore`) chiamano l'API del Pi con il token dell'utente.
- **Validazione invariata**: gli schemi Zod di oggi validano ogni scrittura, sul Pi.
- **I dati escono da git.** Dopo la migrazione `packages/*/data` sparisce dal repo pubblico: i dati non vengono più pubblicati con il sito. Resta la regola per ciò che il sito mostra: citazioni di al massimo due frasi, testo dei libri mai esposto.

## Dati

- Prima versione: una tabella per tipo di documento (`books`, `episodes`, `shows`, `notes`, `explorations`, `chats`, `kobo_queue`, …) con `id`, `data jsonb` e `updated_at`, validata con Zod. Le colonne vere arrivano solo dove servono query o indici.
- I repository di oggi (`packages/explore/src/node/repo.ts` e simili) passano da file a Turso dietro la stessa interfaccia. Per i test resta un'implementazione in memoria o su file, così non serve un DB per `pnpm test`.
- **Migrazione una tantum**: uno script legge `packages/*/data` e popola Turso; gli EPUB di `~/.cache/e-library/books` vanno su R2 come `books/<id>.epub`. Poi i file di dati si tolgono dal repo.
- `site-data/build.ts` e la lettura dei JSON al build spariscono: il frontend legge a runtime.
- **Backup**: un timer notturno sul Pi esporta tutte le tabelle in un unico JSON compresso e lo carica su R2 (`backups/<data>.json.gz`, ultimi 30). Turso ha i suoi ripristini a un punto nel tempo, ma il dump su R2 è indipendente dal fornitore.

## Il Pi

Raspberry Pi 3 Model B, circa 900 MB di RAM, in Wi-Fi sulla stessa LAN del Kobo, con `tailscale` e `cloudflared` già installati.

- **Un solo server Hono** che unisce `chat-dev.ts`, `explore-dev.ts`, `notes-dev.ts` e il server di amministrazione della libreria, con il middleware di autenticazione e CORS per l'origine di GitHub Pages.
- **Niente `pnpm install` sul Pi**: il server si impacchetta in un unico file con esbuild (in una GitHub Action o sul laptop) e si copia sul Pi. Lo gestisce un'unità systemd; i timer (Kobo, backup) sono timer systemd.
- Programmi sul Pi: Node, `kepubify` (build ARM), `ffmpeg`, freeway (già presente). Niente modelli locali.
- **Esposizione**: tunnel HTTPS, nessuna porta aperta sul router. Cloudflare Tunnel richiede un dominio gestito da Cloudflare; senza dominio, Tailscale Funnel dà un indirizzo `*.ts.net` gratuito.

## Kobo

La rete c'è già: il Pi è nella stessa LAN. Restano due problemi.

1. **L'IP cambia (DHCP).** Prenotazione DHCP sul router per il MAC del Kobo. Come riserva, se l'host configurato non risponde, il Pi cerca la porta 2222 sulla `/24`: è sicuro perché la connessione usa `HostKeyAlias` con `StrictHostKeyChecking=yes`, e un dispositivo diverso viene rifiutato. Host e porta stanno nell'env del Pi, non più in `elib.config.json`.
2. **Il Kobo dorme quasi sempre.** Le sync vanno in **coda** (`kobo_queue`): ogni modifica segna il libro come da sincronizzare; un timer sul Pi ogni 5 minuti prova `ssh` con `ConnectTimeout=5` e, se il Kobo risponde, svuota la coda con il `reconcile` di oggi. La UI mostra "in attesa del Kobo" e un pulsante "sincronizza ora". `listing-failed` continua a voler dire "spento".

Le regole sulle cancellazioni non cambiano: il Kobo non ha cestino, `--prune` e le delete solo su richiesta esplicita, dopo un `--dry-run`.

Flusso di un libro nuovo: upload dalla UI o da `elib` → il Pi salva l'EPUB su R2 e i metadati in Turso, e mette il libro in coda → al primo risveglio del Kobo il Pi converte in KEPUB (se non l'ha già in cache) e lo invia con il sidecar.

## Podcast e trascrizione

- Lo script Python lanciato con `uv` viene sostituito da un client HTTP in TypeScript verso Groq.
- Groq accetta file fino a 25 MB: il Pi ricodifica l'audio con `ffmpeg` in mono a 32 kbps (circa 14 MB l'ora), o lo divide in pezzi.
- Le trascrizioni restano sul disco del Pi; lo script che committa i dati dei podcast in git (`core/ingest/git.ts`) sparisce.

## Fasi

1. **Fondamenta**: database Turso, client OAuth Google, tabelle con `data` JSON, bucket R2, script di migrazione.
2. **Repository su Turso**: stessa interfaccia, implementazione Turso per il Pi e in memoria per i test.
3. **Backend sul Pi**: Hono unificato con autenticazione, bundle esbuild, systemd, tunnel, EPUB su R2.
4. **Kobo**: coda, timer di sync, ricerca dell'IP come riserva, chiave SSH sul Pi.
5. **Frontend**: login, dati dall'API del Pi, stato della coda Kobo; via `site-data/build.ts`.
6. **CLI e skill `explore`**: puntano all'API del Pi.
7. **Podcast**: trascrizione via Groq con ricodifica `ffmpeg`.
8. **Chiusura**: backup notturno su R2, rimozione dei server `*-dev.ts` e di `packages/*/data` dal repo.

## Da decidere

- Dominio per Cloudflare Tunnel, oppure Tailscale Funnel.
- Sviluppo locale (`pnpm dev`): un secondo database Turso, o `API_LOCAL_DEV=1` con file locali, o il Pi di produzione da loggati.
- Limiti esatti dei piani gratuiti (Turso, Groq, R2): verificarli sulle pagine ufficiali prima della fase 1.

## Stato delle fasi

| Fase | Stato | Note |
| --- | --- | --- |
| 1. Fondamenta | fatta nel codice, **da eseguire a mano** | `turso/migrations/0001_init.sql` (applicata con `pnpm --filter @ehub/store db:migrate --apply`), `packages/store` (client Turso, R2, mount), `pnpm --filter @ehub/store migrate` (a secco senza `--apply`). Servono: database Turso, bucket R2, variabili in `.env.local`. |
| 2. Repository su Turso | **fatta** | I repository di libreria, esplorazioni, note e podcast passano da `@ehub/store`; test con mount in memoria in `*/hosted.test.ts`. Le CLI di validazione (`elib validate`, `site-data`) leggono ancora file locali: spariscono in fase 5/8. |
| 3. Backend sul Pi | fatta nel codice, **da installare a mano** | `apps/api` (Hono unico: CORS, login Google gestito dall'API + token di sessione + allowlist, GET pubbliche), EPUB su R2 (`cache/remote.ts`), bundle esbuild, `deploy/pi/` (unità systemd, env, `deploy.sh`). Vedi «Installazione sul Pi». |
| 4. Kobo | da fare | |
| 5. Frontend | da fare | |
| 6. CLI e skill `explore` | da fare | |
| 7. Podcast | da fare | |
| 8. Chiusura | da fare | |

## Strato di storage (`@ehub/store`)

Ogni pacchetto legge e scrive i suoi dati con le stesse funzioni di file di prima (`readTextIfExists`, `writeFileAtomic`, `listDir`…), che ora vivono in `@ehub/store`. Se il percorso è dentro una cartella **montata** (`mountHosted`, solo sul Pi) la chiamata va a Turso (tabelle `id`, `data` JSON, `updated_at`) o a R2; altrimenti è `node:fs` come sempre. Così i repository non cambiano interfaccia, i test continuano a usare cartelle temporanee (o `MemoryBackend`) e non serve un DB per `pnpm test`. I file che nessuna rotta rivendica (trascrizioni, audio, cache) restano su disco. Le rotte file → tabella sono in `packages/store/src/hosted.ts`.

Il JSON è salvato come testo: l'ordine delle chiavi si conserva. Il test di `TursoDocClient` gira su SQLite in memoria con la migrazione vera.

## Installazione sul Pi (una tantum, a mano)

1. Utente e cartelle: `sudo useradd -r -m ehub`, `sudo install -d -o ehub /var/lib/ehub/data/{library,explore,notes,podcasts} /var/cache/ehub /etc/ehub`.
2. `/etc/ehub/env` da `deploy/pi/env.example` (permessi 600): qui vivono tutte le chiavi. La chiave SSH del Kobo va in `~ehub/.ssh/` con `known_hosts` per l'alias `ehub-kobo`.
3. Programmi: Node 22+, `kepubify` (build ARM), `ffmpeg`.
4. Dal laptop: `deploy/pi/deploy.sh ggabry@<pi>` costruisce il bundle (`pnpm --filter @ehub/api bundle`), scarica `sharp` per linux-arm64 e copia tutto in `/opt/ehub`, poi riavvia `ehub-api`. `sudo systemctl enable --now ehub-api` la prima volta.
5. Tunnel (da decidere): l'API ascolta su `127.0.0.1:8788`; `cloudflared` o Tailscale Funnel puntano lì. Il dominio e l'origine di Pages stanno in `CORS_ORIGINS`, nessun valore è scritto nel codice.

Variabili di login sul Pi: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_API_URL`, `ALLOWED_EMAILS`. Nella console Google il client OAuth (tipo «Web») ha come URI di reindirizzamento `<PUBLIC_API_URL>/auth/google/callback`. Il sito parte da `<PUBLIC_API_URL>/auth/google?return=<URL del sito>`; `return` deve stare in `CORS_ORIGINS`.

Rotte private anche se `GET`: trascrizioni dei podcast, area di staging degli upload, candidati di copertina, stato Z-Library, riassunti delle esplorazioni (`PRIVATE_GETS` in `apps/api/src/auth.ts`). Cancellare un libro non cancella l'EPUB su R2 (è l'unica copia: si toglie a mano).
