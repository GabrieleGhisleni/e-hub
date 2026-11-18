# Hosting: e-hub fuori dal laptop

Stato: **visione decisa, da implementare** (2026-11-18). Oggi tutto gira sul laptop: i dati sono JSON in git, le scritture passano dai server Hono di dev e dalle CLI. Questo documento descrive dove va ogni pezzo quando l'app diventa hosted.

## Il quadro

```
     Browser (GitHub Pages: React/Vite statico)
                      │ HTTPS, token Supabase per le scritture
                      ▼
          ┌──────────────────────────┐   service key   ┌───────────────┐
          │  Raspberry Pi 3 (casa)   │◄───────────────►│   Supabase    │
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
| Database | **Supabase Postgres** (piano gratuito) | Unica fonte dei dati: libri, podcast, note, esplorazioni, chat, coda del Kobo. |
| Login | **Supabase Auth, provider Google** | Un solo utente: email in allowlist. |
| File | **Cloudflare R2**, bucket privato | EPUB (unica copia) e dump del DB. 10 GB gratis, niente costi di egress, API S3. |
| Backend | **Raspberry Pi 3** dietro un tunnel HTTPS | Unico punto d'accesso ai dati; l'unico che raggiunge il Kobo; freeway ci gira già. |
| Cache di lavoro | Disco del Pi | KEPUB, audio e trascrizioni dei podcast, testo dei libri: tutto ricostruibile. |
| Trascrizione | **Groq**, `whisper-large-v3-turbo` | Gratis (circa 8 h di audio al giorno); riserva: Cloudflare Workers AI. |

## Regole

- **Il frontend parla solo con il Pi.** Nessuna chiave Supabase nel browser oltre al login; nessuna policy RLS da mantenere. Il Pi accede al DB con la service key. Se il Pi è spento, il sito non mostra dati: è accettato.
- **Letture pubbliche, scritture autenticate.** Le rotte `GET` dell'API sono aperte; tutte le altre richiedono il JWT di Supabase, che il Pi verifica (JWKS) controllando l'email in allowlist.
- **Le chiavi stanno solo sul Pi**: service key di Supabase, chiavi R2, token di freeway e Groq, chiave SSH del Kobo. Le CLI del laptop (`elib`, `explore`) chiamano l'API del Pi con il token dell'utente.
- **Validazione invariata**: gli schemi Zod di oggi validano ogni scrittura, sul Pi.
- **I dati escono da git.** Dopo la migrazione `packages/*/data` sparisce dal repo pubblico: i dati non vengono più pubblicati con il sito. Resta la regola per ciò che il sito mostra: citazioni di al massimo due frasi, testo dei libri mai esposto.

## Dati

- Prima versione: una tabella per tipo di documento (`books`, `episodes`, `shows`, `notes`, `explorations`, `chats`, `kobo_queue`, …) con `id`, `data jsonb` e `updated_at`, validata con Zod. Le colonne vere arrivano solo dove servono query o indici.
- I repository di oggi (`packages/explore/src/node/repo.ts` e simili) passano da file a Supabase dietro la stessa interfaccia. Per i test resta un'implementazione in memoria o su file, così non serve un DB per `pnpm test`.
- **Migrazione una tantum**: uno script legge `packages/*/data` e popola Supabase; gli EPUB di `~/.cache/e-library/books` vanno su R2 come `books/<id>.epub`. Poi i file di dati si tolgono dal repo.
- `site-data/build.ts` e la lettura dei JSON al build spariscono: il frontend legge a runtime.
- **Backup**: il piano gratuito di Supabase non ha backup utili. Un timer notturno sul Pi fa `pg_dump` e lo carica su R2 (`backups/<data>.sql.gz`, ultimi 30). La stessa chiamata tiene attivo il progetto, che altrimenti va in pausa dopo 7 giorni senza attività.

## Il Pi

Raspberry Pi 3 Model B, circa 900 MB di RAM, in Wi-Fi sulla stessa LAN del Kobo, con `tailscale` e `cloudflared` già installati.

- **Un solo server Hono** che unisce `chat-dev.ts`, `explore-dev.ts`, `notes-dev.ts` e il server di amministrazione della libreria, con il middleware di autenticazione e CORS per l'origine di GitHub Pages.
- **Niente `pnpm install` sul Pi**: il server si impacchetta in un unico file con esbuild (in una GitHub Action o sul laptop) e si copia sul Pi. Lo gestisce un'unità systemd; i timer (Kobo, backup) sono timer systemd.
- Programmi sul Pi: Node, `kepubify` (build ARM), `ffmpeg`, `pg_dump`, freeway (già presente). Niente modelli locali.
- **Esposizione**: tunnel HTTPS, nessuna porta aperta sul router. Cloudflare Tunnel richiede un dominio gestito da Cloudflare; senza dominio, Tailscale Funnel dà un indirizzo `*.ts.net` gratuito.

## Kobo

La rete c'è già: il Pi è nella stessa LAN. Restano due problemi.

1. **L'IP cambia (DHCP).** Prenotazione DHCP sul router per il MAC del Kobo. Come riserva, se l'host configurato non risponde, il Pi cerca la porta 2222 sulla `/24`: è sicuro perché la connessione usa `HostKeyAlias` con `StrictHostKeyChecking=yes`, e un dispositivo diverso viene rifiutato. Host e porta stanno nell'env del Pi, non più in `elib.config.json`.
2. **Il Kobo dorme quasi sempre.** Le sync vanno in **coda** (`kobo_queue`): ogni modifica segna il libro come da sincronizzare; un timer sul Pi ogni 5 minuti prova `ssh` con `ConnectTimeout=5` e, se il Kobo risponde, svuota la coda con il `reconcile` di oggi. La UI mostra "in attesa del Kobo" e un pulsante "sincronizza ora". `listing-failed` continua a voler dire "spento".

Le regole sulle cancellazioni non cambiano: il Kobo non ha cestino, `--prune` e le delete solo su richiesta esplicita, dopo un `--dry-run`.

Flusso di un libro nuovo: upload dalla UI o da `elib` → il Pi salva l'EPUB su R2 e i metadati in Supabase, e mette il libro in coda → al primo risveglio del Kobo il Pi converte in KEPUB (se non l'ha già in cache) e lo invia con il sidecar.

## Podcast e trascrizione

- Lo script Python lanciato con `uv` viene sostituito da un client HTTP in TypeScript verso Groq.
- Groq accetta file fino a 25 MB: il Pi ricodifica l'audio con `ffmpeg` in mono a 32 kbps (circa 14 MB l'ora), o lo divide in pezzi.
- Le trascrizioni restano sul disco del Pi; lo script che committa i dati dei podcast in git (`core/ingest/git.ts`) sparisce.

## Fasi

1. **Fondamenta**: progetto Supabase, login Google, tabelle `jsonb`, bucket R2, script di migrazione.
2. **Repository su Supabase**: stessa interfaccia, implementazione Supabase per il Pi e in memoria per i test.
3. **Backend sul Pi**: Hono unificato con autenticazione, bundle esbuild, systemd, tunnel, EPUB su R2.
4. **Kobo**: coda, timer di sync, ricerca dell'IP come riserva, chiave SSH sul Pi.
5. **Frontend**: login, dati dall'API del Pi, stato della coda Kobo; via `site-data/build.ts`.
6. **CLI e skill `explore`**: puntano all'API del Pi.
7. **Podcast**: trascrizione via Groq con ricodifica `ffmpeg`.
8. **Chiusura**: backup notturno su R2, rimozione dei server `*-dev.ts` e di `packages/*/data` dal repo.

## Da decidere

- Dominio per Cloudflare Tunnel, oppure Tailscale Funnel.
- Sviluppo locale (`pnpm dev`): un secondo progetto Supabase, o il Pi di produzione da loggati.
- Limiti esatti dei piani gratuiti (Supabase, Groq, R2): verificarli sulle pagine ufficiali prima della fase 1.
