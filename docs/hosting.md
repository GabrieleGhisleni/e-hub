# Hosting: e-hub fuori dal laptop

Stato: **in implementazione** (2026-11-18). Dal ramo `per-user-data` l'app è **multi-utente**: ognuno vede solo i propri dati (sezione «Utenti e isolamento»). Cambio di piano durante i lavori: Turso al posto di Supabase e Google OAuth gestito da Hono al posto di Supabase Auth; vedi «Stato delle fasi» in fondo. Oggi tutto gira sul laptop: i dati sono JSON in git, le scritture passano dai server Hono di dev e dalle CLI. Questo documento descrive dove va ogni pezzo quando l'app diventa hosted.

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
          └────┬───────────────┬─────┘                 │ EPUB          │
               │ SSH (LAN)     │ HTTPS                 └───────────────┘
               ▼               ▼
             Kobo        Groq Whisper
```

| Pezzo | Dove | Perché |
| --- | --- | --- |
| Frontend | **GitHub Pages** | Solo codice statico. Tutti i dati arrivano a runtime dall'API del Pi. |
| Database | **Turso** (libSQL/SQLite, piano gratuito) | Unica fonte dei dati: libri, podcast, note, esplorazioni, chat, coda del Kobo. |
| Login | **Google OAuth gestito dall'API Hono** | Solo le email della allowlist obbligatoria (`ALLOWED_EMAILS`). L'API crea l'utente e emette un proprio token di sessione con lo `sub`. |
| File | **Cloudflare R2**, bucket privato | EPUB (unica copia). 10 GB gratis, niente costi di egress, API S3. |
| Backend | **Raspberry Pi 3** dietro un tunnel HTTPS | Unico punto d'accesso ai dati; l'unico che raggiunge il Kobo; freeway ci gira già. |
| Cache di lavoro | Disco del Pi | KEPUB, audio e trascrizioni dei podcast, testo dei libri: tutto ricostruibile. |
| Trascrizione | **Groq**, `whisper-large-v3-turbo` | Gratis (circa 8 h di audio al giorno); riserva: Cloudflare Workers AI. |

## Regole

- **Il frontend parla solo con il Pi.** Nessuna chiave del database nel browser, solo il token di sessione; nessuna policy da mantenere. Il Pi accede al DB con il token di Turso. Se il Pi è spento, il sito non mostra dati: è accettato.
- **Niente rotte pubbliche, tranne la demo.** Tutte le rotte dell'API, `GET` incluse, richiedono il token di sessione (senza: 401); fanno eccezione `POST /auth/google`, `GET /api/health`, il preflight CORS e le letture della demo (sezione sotto). Il token lo emette l'API dopo il login con Google (Google Identity Services: il browser ottiene l'ID token di Google e lo posta a `POST /auth/google`; `apps/api/src/google.ts` ne verifica firma, `aud` e email verificata, crea o aggiorna l'utente e controlla l'allowlist, se c'è). La risposta è un token firmato HS256 con `SESSION_SECRET`, valido 30 giorni, con lo `sub` di Google come soggetto, che il sito manda come `Authorization: Bearer`. Niente cookie e niente redirect: sito e API stanno su domini diversi.
- **Le chiavi stanno solo sul Pi**: token di Turso, segreto del client Google e `SESSION_SECRET`, chiavi R2, token di freeway e Groq, chiave SSH del Kobo. Le CLI del laptop (`elib`, `explore`) chiamano l'API del Pi con il token dell'utente.
- **Validazione invariata**: gli schemi Zod di oggi validano ogni scrittura, sul Pi.
- **I dati escono da git.** Dopo la migrazione `packages/*/data` sparisce dal repo pubblico: i dati non vengono più pubblicati con il sito. Resta la regola per ciò che il sito mostra: citazioni di al massimo due frasi, testo dei libri mai esposto.

## Dati

- Una tabella per tipo di documento (`books`, `episodes`, `shows`, `notes`, `explorations`, `chats`, `kobo_queue`, …) con `user_id`, `id`, `data` (JSON) e `updated_at`, chiave primaria `(user_id, id)`, validata con Zod. Le colonne vere arrivano solo dove servono query o indici.
- I repository di oggi (`packages/explore/src/node/repo.ts` e simili) passano da file a Turso dietro la stessa interfaccia. Per i test resta un'implementazione in memoria o su file, così non serve un DB per `pnpm test`.
- **Migrazione una tantum**: uno script legge `packages/*/data` e popola Turso, assegnando tutto al proprietario (`--owner-email`); gli EPUB di `~/.cache/e-library/books` vanno su R2 come `users/<sub>/books/<id>.epub`. Poi i file di dati si tolgono dal repo.
- `site-data/build.ts` e la lettura dei JSON al build spariscono: il frontend legge a runtime.
- **Niente backup notturno del database**: ci si affida al ripristino a un punto nel tempo di Turso. R2 serve solo per gli EPUB.

## Utenti e isolamento

Ogni persona che fa login vede e modifica **solo i propri dati**. L'isolamento sta nello strato di storage, non nelle rotte.

- **Tabella `users`** (`turso/migrations/0002_per_user.sql`): `id` = `sub` di Google, `email` (unica), `name`, `created_at`. Il login (`POST /auth/google`) crea o aggiorna la riga; il token di sessione porta lo `sub`.
- **Allowlist obbligatoria**: `ALLOWED_EMAILS` elenca le email che possono entrare; **vuota = non entra nessuno** (l'API non parte senza). Un'email fuori lista riceve 403 («Account non abilitato.», mostrato nel banner del sito) e non crea nessun utente; l'elenco è controllato a ogni richiesta, quindi togliere un'email blocca subito la persona.
- **Tutte le tabelle di dati** hanno `user_id` e chiave primaria `(user_id, id)`; `topics` ('all') è una riga per utente. `0002` ricrea le tabelle copiando le righe esistenti sotto l'utente `legacy` (un database appena creato non ne ha).
- **Impossibile dimenticare il filtro**: `DocClient` espone solo `forUser(userId)`, e ogni query del handle restituito porta `WHERE user_id = ?` (o lo scrive in INSERT). Non esiste una lettura o scrittura senza proprietario. Il middleware di autenticazione esegue ogni richiesta dentro `runAsUser(sub, …)` (`AsyncLocalStorage`); il backend montato (`HostedBackend`) legge l'utente da lì a **ogni** operazione e **lancia `NoUserError`** se non c'è. Quindi i repository dei pacchetti (che chiamano `readTextIfExists` & co.) non cambiano e non possono uscire dal perimetro dell'utente. Le rotte `/api/store/…` delle CLI passano dallo stesso percorso.
- **File**: R2 `users/<sub>/books/<id>.epub` e `users/<sub>/covers/<id>.webp` (`scopedBlobs` aggiunge il prefisso e rifiuta `..`). Cache su disco del Pi in `<cache>/users/<sub>/…` (EPUB, KEPUB, testo, upload, esplorazioni; trascrizioni dei podcast in `<dati>/podcasts/users/<sub>/transcripts`), tramite `userScopedDir`. Cache e stato in memoria (riassunti in corso) sono per utente.
- **Kobo**: un solo dispositivo, nella LAN del proprietario. `KOBO_OWNER_EMAIL` decide chi lo usa: per tutti gli altri ogni operazione Kobo (sync, coda, evidenziazioni, cancellazioni) è un no-op silenzioso e la sezione non compare (`/auth/me` e il login rispondono `kobo: true|false`; la coda è vuota). Host, porta e chiave SSH (`ELIB_KOBO_*`) valgono solo per lui. Il timer `ehub-kobo-sync` svuota la coda del proprietario; finché non ha fatto login non fa nulla.
- **Chat e trascrizioni** lavorano sui dati dell'utente della richiesta (stesso contesto). Il router freeway e la chiave Groq sono condivisi: le quote sono di tutti.
- **Frontend**: nel build hosted, senza sessione il sito mostra la demo (sezione sotto); una risposta 401 a una sessione esistente la cancella e ricarica la pagina.
- **CLI** (`explore`): con `EHUB_API_URL` + `EHUB_API_TOKEN` (il token si copia dal sito dopo il login) lavorano sui dati di quell'utente. `elib` e `episode` restano strumenti del Pi.
- **Z-Library è per utente**: ogni utente collega il proprio account dal pannello di ricerca (email e password, inviate una volta). Il server tiene solo la chiave di sessione in `<cache>/users/<sub>/zlibrary-session.json` (permessi 600), mai la password; «Esci» la cancella. Le variabili `ZLIBRARY_*` valgono solo senza utente (sviluppo locale senza login).

### La demo per chi non è loggato

- **Utente riservato `demo`** (`DEMO_USER_ID`): non è un account Google. Il login rifiuta `sub = demo`, il verificatore dei token non accetta mai una sessione per lui, e la sua email (`demo@demo.invalid`) non è in allowlist.
- **Solo letture**: una richiesta `GET`/`HEAD` **senza header `Authorization`** a una delle rotte di `DEMO_GETS` (`apps/api/src/auth.ts`: indice, schede e copertine del sito della libreria, argomenti, catalogo e tag dei podcast, note, esplorazioni con il loro id) viene servita come `demo`. Tutto il resto senza token è 401: scritture, chat, Kobo, upload, trascrizioni, riassunti, `/api/store`, Z-Library. Un token sbagliato non ricade mai sulla demo (401).
- **Contenuto**: `demo/seed/` (stessa struttura delle cartelle dati): 4 libri di pubblico dominio con copertina generata e argomento, 2 note, 1 esplorazione, 1 podcast inventato con un episodio. Testi scritti per la demo; nessun dato reale dell'utente. Si carica con `pnpm --filter @ehub/store seed-demo` (serve `.env.local` come per la migrazione): cancella e riscrive **solo** righe e file di `demo` (`users/demo/…` su R2), quindi si può rilanciare quando si cambia la fixture.
- **UI**: banner «Stai guardando una demo» con il pulsante «Accedi con Google»; i controlli di modifica, la chat e il Kobo non compaiono (stesso flag admin del sito, spento senza sessione).

### Il proprietario e la migrazione dei dati esistenti

`pnpm --filter @ehub/store migrate --owner-email tu@example.com [--apply]` assegna **tutti** i dati attuali (`packages/*/data`, EPUB, copertine) a quell'utente. Se non ha ancora mai fatto login, lo `sub` non si conosce: la riga `users` e tutti i dati prendono l'id provvisorio `email:<indirizzo>`. Al **primo login con quell'email (verificata da Google)** l'API collega il proprietario: rinomina le righe di tutte le tabelle in una volta sola (`UserStore.reassign`, ripetibile se si interrompe) e sposta gli oggetti R2 da `users/email:<indirizzo>/` a `users/<sub>/` (`moveUserBlobs`). Un secondo account Google con la stessa email ma `sub` diverso viene rifiutato (403). Se invece il proprietario ha già fatto login, la migrazione scrive direttamente sotto il suo `sub`.

## Il Pi

Raspberry Pi 3 Model B, circa 900 MB di RAM, in Wi-Fi sulla stessa LAN del Kobo, con `tailscale` e `cloudflared` già installati.

- **Un solo server Hono** che unisce `chat-dev.ts`, `explore-dev.ts`, `notes-dev.ts` e il server di amministrazione della libreria, con il middleware di autenticazione e CORS per l'origine di GitHub Pages.
- **Niente `pnpm install` sul Pi**: il server si impacchetta in un unico file con esbuild (in una GitHub Action o sul laptop) e si copia sul Pi. Lo gestisce un'unità systemd; il timer del Kobo è un timer systemd.
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
8. **Chiusura**: rimozione dei server `*-dev.ts` e di `packages/*/data` dal repo (il backup notturno è stato tolto dal piano).

## Da decidere

- Dominio per Cloudflare Tunnel, oppure Tailscale Funnel.
- ~~Sviluppo locale~~ risolto: il client libSQL accetta `TURSO_DATABASE_URL=file:./dev.db` (o `:memory:`), senza token né rete (`localDbFromEnv`); resta anche `API_LOCAL_DEV=1` con file JSON e senza login. Rimane da decidere solo quando togliere i server `*-dev.ts`.
- Limiti esatti dei piani gratuiti (Turso, Groq, R2): verificarli sulle pagine ufficiali prima della fase 1.

## Stato delle fasi

| Fase | Stato | Note |
| --- | --- | --- |
| 1. Fondamenta | fatta nel codice, **da eseguire a mano** | `turso/migrations/0001_init.sql` (applicata con `pnpm --filter @ehub/store db:migrate --apply`), `packages/store` (client Turso, R2, mount), `pnpm --filter @ehub/store migrate --owner-email <email>` (a secco senza `--apply`). `db:migrate` applica ogni file una volta sola (tabella `schema_migrations`, ogni file in una transazione). Servono: database Turso, bucket R2, variabili in `.env.local`. |
| 2. Repository su Turso | **fatta** | I repository di libreria, esplorazioni, note e podcast passano da `@ehub/store`; test con mount in memoria in `*/hosted.test.ts`. Le CLI di validazione (`elib validate`, `site-data`) leggono ancora file locali: spariscono in fase 5/8. |
| 3. Backend sul Pi | fatta nel codice, **da installare a mano** | `apps/api` (Hono unico: CORS, login Google gestito dall'API + token di sessione + allowlist, GET pubbliche), EPUB su R2 (`cache/remote.ts`), bundle esbuild, `deploy/pi/` (unità systemd, env, `deploy.sh`). Vedi «Installazione sul Pi». |
| 4. Kobo | fatta nel codice, **da attivare sul Pi** | Coda `kobo_queue` (`kobo/queue.ts`): con `ELIB_KOBO_QUEUE=1` i servizi mettono in coda invece di fallire; `ehub-kobo-sync.timer` ogni 5 minuti svuota la coda con `reconcile` (mai `--prune`); ricerca dell'IP sulla `/24` come riserva (`kobo/discovery.ts`); host, porta e alias da `ELIB_KOBO_*`; rotte `GET /api/library/kobo/queue` e `POST /api/library/kobo/sync` («sincronizza ora»). La UI arriva in fase 5. |
| 5. Frontend | fatta nel codice | Build «hosted» (`pnpm --filter @ehub/web build:hosted`, `VITE_HOSTED=1`, `VITE_API_URL`): niente dati nel bundle, tutto dall'API (`/api/library/site/*`, `/api/podcasts/catalog`, `/api/notes`, `/api/explore`); login con Google (`apps/web/src/session.ts`); coda del Kobo con «Sincronizza ora» nella barra admin della libreria; workflow Pages aggiornato. `site-data/build.ts` resta, ma ora lo usa l'API a runtime. |
| 6. CLI e skill `explore` | fatta (solo `explore`) | `/api/store/<radice>/<chiave>` (solo con sessione, validazione Zod per tabella sul Pi) e `RemoteBackend` nel client: con `EHUB_API_URL` + `EHUB_API_TOKEN` la CLI `explore` lavora sui dati hosted; la skill lo spiega. `elib` e `episode` NON sono collegate: servono cache EPUB, Kobo e trascrizioni, che stanno sul Pi (si usano lì o dall'app). |
| 7. Podcast | fatta nel codice, **serve `GROQ_API_KEY` e `yt-dlp` sul Pi** | `src/cli/transcribe/groq.ts`: scarica l'audio (yt-dlp o feed), `ffmpeg` mono 16 kHz 32 kbps, divide in parti da 90 minuti se supera 24 MB, una chiamata a Groq per parte con ripresa e attesa sui 429. Le trascrizioni non hanno più speaker (Groq non li dà). `transcriber/` (Python) rimosso. (Nota: `core/ingest/git.ts` non è uno script che committa i dati, come scritto sopra: è il runner di `git` per il clone del wiki di Huberman, e resta.) |
| 8. Chiusura | **in parte** | Backup notturno **tolto dal piano** (si usa il ripristino di Turso). **Non fatto di proposito**: rimozione di `packages/*/data` (aspetta la conferma che la migrazione è avvenuta e verificata) e dei server `*-dev.ts` (dipende dalla scelta sullo sviluppo locale, punto ancora aperto). |

## Strato di storage (`@ehub/store`)

Ogni pacchetto legge e scrive i suoi dati con le stesse funzioni di file di prima (`readTextIfExists`, `writeFileAtomic`, `listDir`…), che ora vivono in `@ehub/store`. Se il percorso è dentro una cartella **montata** (`mountHosted`, solo sul Pi) la chiamata va a Turso (tabelle `id`, `data` JSON, `updated_at`) o a R2; altrimenti è `node:fs` come sempre. Così i repository non cambiano interfaccia, i test continuano a usare cartelle temporanee (o `MemoryBackend`) e non serve un DB per `pnpm test`. I file che nessuna rotta rivendica (trascrizioni, audio, cache) restano su disco. Le rotte file → tabella sono in `packages/store/src/hosted.ts`.

Il JSON è salvato come testo: l'ordine delle chiavi si conserva. Il test di `TursoDocClient` gira su SQLite in memoria con la migrazione vera.

## Installazione sul Pi (una tantum, a mano)

1. Utente e cartelle: `sudo useradd -r -m ehub`, `sudo install -d -o ehub /var/lib/ehub/data/{library,explore,notes,podcasts} /var/cache/ehub /etc/ehub`.
2. `/etc/ehub/env` da `deploy/pi/env.example` (permessi 600): qui vivono tutte le chiavi. La chiave SSH del Kobo va in `~ehub/.ssh/` con `known_hosts` per l'alias `ehub-kobo`.
3. Programmi: Node 22+, `kepubify` (build ARM), `ffmpeg`.
4. Dal laptop: `deploy/pi/deploy.sh ggabry@<pi>` costruisce il bundle (`pnpm --filter @ehub/api bundle`), scarica `sharp` per linux-arm64 e copia tutto in `/opt/ehub`, poi riavvia `ehub-api`. `sudo systemctl enable --now ehub-api` la prima volta.
5. Tunnel (da decidere): l'API ascolta su `127.0.0.1:8788`; `cloudflared` o Tailscale Funnel puntano lì. Il dominio e l'origine di Pages stanno in `CORS_ORIGINS`, nessun valore è scritto nel codice.

Variabili di login sul Pi: `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ALLOWED_EMAILS` (obbligatoria), `KOBO_OWNER_EMAIL`. Nella console Google il client OAuth (tipo «Web») ha come «Origini JavaScript autorizzate» l'origine di Pages; non servono URI di reindirizzamento né il segreto del client.

Nessuna rotta è pubblica (nemmeno i `GET`), salvo le letture della demo. Cancellare un libro non cancella l'EPUB su R2 (è l'unica copia: si toglie a mano).

## Kobo sul Pi

- Prenotazione DHCP sul router per il MAC del Kobo (la via principale). Se l'indirizzo cambia lo stesso, `ehub-kobo-sync` cerca la porta SSH sulla `/24` del Pi e accetta solo un dispositivo che passa il login con `StrictHostKeyChecking=yes` sotto l'alias `ELIB_KOBO_HOST_KEY_ALIAS` (senza alias la ricerca è disattivata). L'indirizzo trovato è ricordato in `<cache>/kobo-host`.
- Una tantum, a mano: copiare sul Pi la chiave SSH del Kobo (`~ehub/.ssh/`) e aggiungere a `known_hosts` la chiave del Kobo con l'alias (`ssh-keyscan -p 2222 <ip>` poi sostituire l'host con `ehub-kobo`; controllare l'impronta a mano).
- Le sync fatte mentre il Kobo dorme escono come avviso `queued` nel resoconto. Le cancellazioni di libri restano dirette (falliscono se il Kobo è spento, come oggi) e non passano dalla coda.

## Frontend hosted

- **Build**: `VITE_HOSTED=1 VITE_API_URL=https://<api> pnpm --filter @ehub/web build:hosted` (il workflow di Pages lo fa; `API_URL` è una *variabile* del repository GitHub, non un segreto). Emette anche `404.html` per i link diretti.
- **Admin dopo il login**: i controlli di scrittura (`__ELIB_ADMIN__` e `import.meta.env.DEV`) nel build hosted diventano un unico flag a runtime (`globalThis.__EHUB_ADMIN__`), impostato da `src/session.ts` prima che qualsiasi modulo lo legga. Accedere e uscire ricarica la pagina. Il codice admin è nel bundle (il repo è pubblico: non c'è nulla da nascondere); a proteggere le scritture è l'API.
- **Login**: il pulsante «Accedi con Google» (Google Identity Services, `VITE_GOOGLE_CLIENT_ID`) dà un ID token, `POST /auth/google` lo scambia con il token di sessione, che finisce in `localStorage`. `fetch` è avvolta (`apiFetch`) e manda il token solo alle chiamate `/api/…` e `/auth/…`.
- **Se il Pi è spento** le chiamate falliscono e il sito mostra gli errori di rete già gestiti dai moduli (nessun dato in cache: scelta fatta).
- Il build non hosted (`pnpm build`) resta com'è finché non si chiude la fase 8.

## Cosa resta da fare a mano

Nell'ordine in cui conviene farlo:

1. **Turso**: creare il database, un token con scrittura, mettere `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` in `.env.local` (e in `/etc/ehub/env` sul Pi), poi `pnpm --filter @ehub/store db:migrate --apply`. Un token incollato in chat va considerato compromesso: revocarlo e crearne uno nuovo.
2. **R2**: bucket privato e token S3 (`R2_*`).
3. **Demo**: dopo `db:migrate --apply`, `pnpm --filter @ehub/store seed-demo`.
4. **Google**: client OAuth «Web» con l'origine di Pages tra le origini JavaScript autorizzate; `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ALLOWED_EMAILS` (obbligatoria), `KOBO_OWNER_EMAIL`, e la variabile GitHub `GOOGLE_CLIENT_ID` per il build.
5. **Migrazione dei dati**: prima `db:migrate --apply` (applica 0001 e 0002), poi `pnpm --filter @ehub/store migrate --owner-email <la tua email>` (a secco), poi `--apply` solo dopo aver controllato l'elenco; confrontare i conti con la UI.
6. **Pi**: installazione una tantum (sezione sopra), `deploy/pi/deploy.sh`, chiave SSH e `known_hosts` del Kobo, `kepubify`, `ffmpeg`, `yt-dlp`, `GROQ_API_KEY`.
7. **Tunnel**: Cloudflare Tunnel (serve un dominio) o Tailscale Funnel verso `127.0.0.1:8788`; poi `CORS_ORIGINS` e la variabile `API_URL` del repository GitHub.
8. **Chiusura (fase 8)**, solo dopo la conferma: togliere `packages/*/data` dal repo e dal build, e i server `*-dev.ts` una volta scelto come si sviluppa in locale (`API_LOCAL_DEV=1 pnpm --filter @ehub/api start` è già un'opzione: stessa API su file locali, senza login).

Da sapere: il build non hosted (`pnpm build`) e i server di dev funzionano ancora come prima; `elib` e `episode` restano strumenti del Pi (servono cache EPUB, Kobo, trascrizioni).
