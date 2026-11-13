# Migrazione: da Google Drive (rclone) a Kobo via SSH

Stato: **in corso** (2026-11-12). Il codice è in riscrittura secondo questo documento; le decisioni sotto sono quelle valide.

## Decisioni già prese

1. **Niente più Google Drive.** Si rimuovono il modulo `src/node/drive/`, il wrapper rclone, l'albero Archivio e tutti i riferimenti a Drive nella UI, nei test e nella config.
2. **Il Kobo riceve i KEPUB via SSH.** Host `root@192.168.1.11` (era `.8`: l'IP cambia con il DHCP; `ELIB_KOBO_HOST` lo sovrascrive senza toccare la config, `kobo.hostKeyAlias` tiene valido il controllo della chiave host), porta `2222`, chiave `~/.ssh/id_ecds_kobo`.
3. **Cartella sul Kobo: `/mnt/onboard/books/` piatta.** Niente sottocartelle per argomento (provate e abbandonate l'11/11): l'argomento è la _serie_ del libro, scritta nel sidecar KOReader (sezione sotto). I nomi senza `[<id>]` (es. `Clear, James - Atomic habits.kepub.epub` e la sua `.sdr`) non sono gestiti dall'app: mai rinominati né rimossi, nemmeno con `--prune`.
4. **Gli EPUB restano solo nella cache locale** (`~/.cache/e-library`). Senza cache, `elib text` e le copertine non possono ricaricare l'EPUB: si segnala un avviso, non si scarica più nulla.
5. **Duplicati controllati in locale**: MD5 del file caricato confrontato con gli EPUB già in cache (`cache/books/<id>/<id>.epub`), non con un albero remoto.

## Organizzazione per argomento: metadati di serie (custom_metadata.lua)

Stato al 2026-11-11: **il tag di serie nell'OPF non funziona** (il firmware Kobo non lo legge, e il database `KoboReader.sqlite` non ha righe per i nuovi libri). **Funziona il file sidecar di KOReader**: `<titolo file>.kepub.sdr/custom_metadata.lua` con `custom_props.series`. È il formato che KOReader scrive quando si modificano i metadati a mano, e il libro _Four Thousand Weeks_ con `series = "Saggistica"` è stato il primo a mostrare la differenza.

Regola per tutti i libri caricati:

- cartella `<nome file senza .epub>.sdr/` accanto al KEPUB, nella radice di `/mnt/onboard/books/` (flat, senza sottocartelle);
- file `custom_metadata.lua` con `custom_props.series` = etichetta dell'argomento (`Saggistica`, `Filosofia`, `Narrativa`) e `doc_props` (autore, titolo, lingua, descrizione);
- li genera `src/node/kobo/sidecar.ts` (ex `make_sidecars.py`); `reconcile` li riscrive solo quando l'MD5 sul Kobo è diverso;
- la cartella `.sdr` contiene anche `metadata.epub.lua` (progressi di lettura, evidenziazioni di KOReader): i rename spostano l'intera cartella, la cancellazione di un libro la rimuove (irreversibile).

Stato al 2026-11-12 (verificato via SSH): i tre libri gestiti (`78w462eb`, `eec5cpre`, `stpgkrdt`) hanno KEPUB e sidecar nella radice di `/mnt/onboard/books/`. Il sidecar di _Four Thousand Weeks_ è quello scritto da KOReader (descrizione HTML dall'EPUB): al primo `elib sync` viene riscritto con i dati di `book.json`.

## Conseguenze di design

- Il nome del file sul Kobo resta quello di oggi: `<Autore> - <Titolo> [<id>].kepub.epub` (`driveFileName` in `src/shared/naming.ts`, da rinominare in `koboFileName`). Il `[<id>]` identifica il libro anche se il titolo cambia.
- Cambiare **argomento** riscrive solo `custom_metadata.lua` (serie). Rinominare un **argomento** riscrive la serie di tutti i suoi libri.
- Cambiare **titolo o primo autore** rinomina sul Kobo il KEPUB _e_ la sua cartella `.sdr` (`mv` remoto), poi riscrive i metadati.
- Cancellare un libro: `rm -rf` del KEPUB e della `.sdr` sul Kobo, poi rimozione della cartella nel repo. La cache resta come ultima copia locale. Il Kobo non ha cestino: la cancellazione è definitiva.
- Dopo ogni scrittura si esegue `sync` sul Kobo.
- Kobo spento o fuori dal Wi-Fi: la modifica nel repo resta, il report ha l'errore `listing-failed` e `elib sync` completa più tardi.

## Architettura proposta

Nuovo modulo `src/node/kobo/`:

- `transport.ts`: interfaccia `KoboTransport` (`list`, `md5`, `upload`, `writeFile`, `rename`, `remove`, `flush`), percorsi relativi a `booksDir` validati da `assertSafeRelPath` (max 2 segmenti, niente `.`/`..`/nomi nascosti).
  - `ssh.ts` → `sshTransport(kobo)`: esegue `ssh` con `execFile`/`spawn` (nessuna shell locale), `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=5`, connessione riusata (`ControlMaster`). Nomi remoti tra apici singoli (`'` → `'\''`). Upload e scritture: file nascosto temporaneo nella stessa cartella, poi `mv`.
  - `local.ts` → `localTransport(dir)`: stessa interfaccia su una cartella locale, usata nei test e scelta da `ELIB_KOBO_LOCAL_DIR` (utile anche con il Kobo montato via USB).
- `sidecar.ts`: genera `custom_metadata.lua` (serie = etichetta argomento, `doc_props` da `book.json`).
- `sync.ts`: `reconcile(ctx, ids | "all", { dryRun, prune })` e `reconcileBooks(ctx, books)` restituiscono il `ReconcileReport`. Per ogni libro: KEPUB mancante → upload dalla cache (rigenerato con kepubify dall'EPUB in cache se serve; senza cache → errore `missing-in-cache`); stesso ID con altro nome → rename di KEPUB e `.sdr`; sidecar diverso → riscrittura. Con `"all"` segnala gli orfani (nomi riconosciuti, ID non nel repo); con `prune` li rimuove. `removeBookFiles(ctx, id)` per la cancellazione.
- `duplicates.ts`: MD5 dell'EPUB caricato confrontato con gli EPUB in cache.
- `prune-guard.ts`: spostare da `drive/` così com'è (stessi limiti: 10 file / 20%, rifiuto se 0 libri), ma riferito al Kobo.
- `context.ts`: `KoboContext { dataDir, cacheDir, transport, dryRun, kepubify }`, creato da `createKoboContext(config, options)`. Opzione `transport` per iniettare `localTransport` nei test.

Config (`elib.config.json`, `src/shared/config.ts`): sostituire `drive` con

```json
"kobo": {
  "host": "root@192.168.1.11",
  "port": 2222,
  "identityFile": "~/.ssh/id_ecds_kobo",
  "booksDir": "/mnt/onboard/books"
}
```

`hostKeyAlias` (facoltativo) è il nome con cui ssh cerca la chiave host in `known_hosts`. Con `ELIB_KOBO_HOST=root@<nuovo IP>` si cambia indirizzo senza toccare il file.
Nota: l'IP LAN (privato) finisce nel repo pubblico. Valutare se spostarlo in un file locale ignorato da git (es. `elib.local.json`) prima del commit.

## Mappa dei file da cambiare

Da eliminare:

- `src/node/drive/` (intero modulo, ~1.600 righe)
- `test/helpers/rclone.ts`, `test/node/drive/` (intero)

Da riscrivere o adattare:

- `src/shared/config.ts`, `src/shared/paths.ts` (`driveTreeDir`, `expectedDrivePaths`, `remoteSpec`, `UnknownTopicError` può restare se serve)
- `src/shared/naming.ts` (`driveFileName` → `koboFileName`, `parseDriveFileName` → `parseKoboFileName`; i commenti parlano di Drive)
- `src/shared/api.ts`: azioni `upload` | `rename` | `remove` | `metadata` (via `tree`, `move`, `trash`, `rmdir`), codice errore `drive-failed` → `kobo-failed`
- `src/shared/schema.ts` (riferimenti a `driveFileName` / path)
- `src/node/services/context.ts` (`drive: DriveContext` → `kobo: KoboContext`)
- `src/node/services/books.ts`: creazione (solo KEPUB), modifica (rename), cancellazione (rm remoto), bulk
- `src/node/services/uploads.ts`: `findDuplicatesByMd5` diventa un confronto con la cache; `dropOrphanMd5Matches` resta
- `src/node/services/import.ts`: archivio remoto → indice MD5 della cache; messaggi "su Drive" → "nella libreria"
- `src/node/services/covers.ts`: rimuovere `downloadEpubFromDrive`; senza cache, avviso
- `src/node/services/topics.ts`: nessun file si sposta; `renameTopicFolders` e `reconcile` esce di scena (verificare i test di delete topic)
- `src/node/text/index.ts`: niente download; errore `NoEpubError` se non in cache
- `src/node/cli/commands/sync.ts`, `import.ts`, `text.ts`: testi e chiamate
- `src/node/server/security.ts` (commento), `src/node/services/internal.ts` (commento sulla cache)
- `src/node/site-data/validate.ts`: il controllo "niente ID Drive nel repo" può restare (è una guardia sul repo pubblico); togliere solo i riferimenti testuali
- UI (`src/web/admin/`): `reconcile-report.tsx`, `delete-book-dialog.tsx`, `topics-page.tsx`, `edit-book-sheet.tsx`, `bulk-edit-dialog.tsx`, `change-cover-dialog.tsx`, `upload-page.tsx`, `book-form-fields.tsx`, `lib/book-form.ts` (`moves`), `lib/report.ts`, `lib/errors.ts`, `notify.ts`. Tutte le stringhe in italiano che nominano Drive / Archivio / cestino vanno riscritte.
- Test: `test/shared/naming.test.ts`, `test/shared/paths.test.ts`, `test/shared/schema.test.ts`, `test/node/config.test.ts`, `test/node/services/setup.ts`, `test/node/services/books.test.ts`, `test/node/text/extract.test.ts`, `test/web/admin/report-errors.test.ts`, `test/helpers/helpers.test.ts`, `test/helpers/test-env.ts`, `test/node/site-data/validate.test.ts`, `test/node/cli/cli.test.ts`
- Nuovi test: `test/node/kobo/` con `localTransport` (rename, upload, prune, guardia, dry-run)
- Documentazione: `README.md` (riga su Google Drive e rclone), `docs/README.md`, `docs/esplorazioni.md` (riga su "scarica da Drive"), `docs/PLAN.md` / `docs/PROGRESS.md` (storico: lasciare, o aggiungere una nota "superato")

## Passi, in ordine

1. Scrivere `src/node/kobo/` (transport SSH + locale, sync, prune-guard) con test sul `localTransport`.
2. Cambiare config e schema (`kobo` al posto di `drive`) e aggiornare `elib.config.json`.
3. Rinominare `driveFileName` → `koboFileName` in `shared/naming.ts` e aggiornare i test di naming.
4. Riscrivere `services/context.ts`, poi `books.ts`, `topics.ts`, `uploads.ts`, `import.ts`, `covers.ts`.
5. Riscrivere `text/index.ts` senza download.
6. Aggiornare CLI (`sync`, `import`, `text`).
7. Aggiornare `shared/api.ts` (report, codice `kobo-failed`) e la UI (testi, `lib/errors.ts`, `lib/report.ts`).
8. Eliminare `src/node/drive/` e `test/node/drive/`, `test/helpers/rclone.ts`.
9. Aggiornare README e docs.
10. Verifica: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `packages/library`. Poi un test reale in sola scrittura: `elib sync --dry-run` contro il Kobo, poi un upload di un KEPUB di prova.

## Rischi e cose da verificare

- **Duplicati locali**: scansionare tutti gli EPUB in cache a ogni upload può essere lento. Valutare un indice MD5 in cache (`cache/md5-index.json`), aggiornato alla scrittura.
- **Cache mancante**: un libro senza cache non può essere ricaricato sul Kobo. Serve un comando per segnalarli (`elib sync` deve avvisare).
- **Dati già su Drive**: i libri già caricati su Drive hanno ID nei nomi e KEPUB in cache? Verificare prima di eliminare il modulo, altrimenti la cache va ricostruita a mano.
- **Sicurezza SSH**: la chiave resta in `~/.ssh`, mai nel repo. Usare `BatchMode=yes` e `StrictHostKeyChecking` esplicito.
- **Kobo e permessi**: il Kobo è montato come root; testare che `mv` e `rm` funzionino sul filesystem `/mnt/onboard`.
- **Rimozione definitiva**: senza cestino, `elib sync --prune` e la cancellazione di un libro sono irreversibili. Mantenere il rifiuto di sicurezza di `prune-guard`.
