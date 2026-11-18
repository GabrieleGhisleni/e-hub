---
name: explore
description: Esplora uno o più libri partendo da una domanda, prima di leggerli, e chiude con un verdetto per libro (leggere tutto, leggere i capitoli X, non leggere, da decidere). Usala quando l'utente vuole esplorare un tema nei suoi libri, decidere se o cosa leggere, o continuare un'esplorazione esistente (anche iniziata nella chat dell'app). Lavora sui file di packages/explore/data attraverso la CLI `pnpm --silent explore`.
---

# Esplorazione di libri

Un'esplorazione è una **domanda** più alcune **fonti** (libri). Lo scopo è il triage: capire cosa dicono le fonti sul tema, dove ne parlano e se vale la pena leggerle, tutte o in parte. Si chiude con un **verdetto per fonte**, una **sintesi**, le **note** e una voce di **diario**. Il piano completo è in `docs/esplorazioni.md`.

La stessa esplorazione si apre anche nell'app (`pnpm dev`, pagina `/explore/<id>`, pulsante "Chatta"). Skill e app leggono e scrivono gli stessi file: il **diario** è il modo in cui l'una sa cosa ha fatto l'altra.

## Regole fisse

- **Mai JSON a mano.** Ogni scrittura passa da `pnpm --silent explore …` (dalla radice del repo), che valida il file. Su `verdict`, `note` e `journal` passa sempre `--via skill`.
- **Percorsi assoluti** per `--epub` e `--text-file` (la CLI gira nella cartella del pacchetto e risolve i relativi rispetto alla radice del repo).
- **Testi lunghi** (note, sintesi, diario): con `--text-file -` e un heredoc, mai dentro le virgolette di un argomento.
- **Il repo è pubblico.** Nelle note e nella sintesi solo parole tue o dell'utente, citazioni di al massimo due frasi. Il testo dei capitoli resta nella cache (`~/.cache/e-library`), mai nel repo.
- **Libri non in libreria**: si aggiungono con `--epub <file>` e restano "solo da esplorare" (cache locale, niente Drive né Kobo). Non importarli in libreria a meno che l'utente lo chieda esplicitamente.
- **Niente commit** se l'utente non lo chiede.

## 1. Avvio o ripresa

- Elenco: `pnpm --silent explore list`. Stato completo: `pnpm --silent explore show <id>`.
- **Ripresa**: leggi `pnpm --silent explore show <id>` per intero prima di fare altro. Domanda, verdetti già dati, note e diario dicono cosa è già stato visto (anche nell'app): non rifarlo, riparti da "cosa resta da vedere".
- **Nuova**: chiedi domanda e fonti se mancano, proponi un titolo breve, poi:
  ```bash
  pnpm --silent explore new --title "Nietzsche e la morale cristiana" --question "Che cosa dice Nietzsche della morale cristiana, e dove?" --book 78w462eb --epub /home/<utente>/Scaricati/genealogia.epub
  ```
  Gli ID dei libri in libreria sono le cartelle di `packages/library/data/books/` (titolo in `book.json`). Per aggiungere o togliere fonti dopo: `pnpm --silent explore add <id> --book <bookId>` (oppure `--epub <file>`), `pnpm --silent explore remove <id> --book <bookId>`.

## 2. Preparazione delle fonti e budget

```bash
pnpm --silent explore prepare <id>
```

Per ogni libro estrae il testo se manca (`elib text` per i libri della libreria, che può scaricare l'EPUB da Drive), e stampa capitoli, parole, token stimati, se c'è una sintesi `summary.json` e la **cartella del testo**: un file Markdown per capitolo, `00-index.md` e `manifest.json`. Alla fine stampa il totale e la **strategia**.

- La cartella del testo sta fuori dal repo: se non puoi leggerla, chiedi all'utente di aggiungere `~/.cache/e-library` alle directory leggibili.
- **Strategia "intero"** (totale sotto la soglia, 500k token di default; `--budget` per cambiarla): leggi tutti i capitoli di tutti i libri, saltando le parti accessorie (copyright, ringraziamenti, indici).
- **Strategia "per capitoli"**: parti da `00-index.md` e, per i libri della libreria, da `packages/library/data/books/<id>/summary.json` (sintesi del libro e di ogni capitolo). Poi cerca con `grep -i -n` nei capitoli, espandendo la query con sinonimi e traduzioni nella lingua del libro (per esempio _pity_, _compassion_, _Mitleid_, _compassione_), e leggi solo i capitoli pertinenti.
- Se un EPUB "solo da esplorare" non è più in cache, `prepare` lo dice: chiedi all'utente il file e rilancia `pnpm --silent explore add <id> --epub <file>`.

## 3. Esplorazione

Conversazione libera con l'utente, nella sua lingua.

- **Ogni affermazione sulle fonti cita libro e capitolo**: («Titolo breve», cap. N).
- **Citazioni letterali**: al massimo due frasi, e prima di riportarle verificale con `grep` sul file del capitolo. Su contesti lunghi il ritrovamento di un passaggio preciso è meno affidabile del triage.
- Se una fonte non parla del tema, dillo. Non attribuire all'autore cose che non hai trovato nel testo.
- **Note**: quando l'utente vuole tenere una risposta (o tu lo proponi e lui accetta):
  ```bash
  pnpm --silent explore note <id> --book <bookId> --via skill --text-file - <<'EOF'
  Testo della nota, con parole tue.
  EOF
  ```
  `--book` è facoltativo (una nota può riguardare l'intera domanda).

## 4. Chiusura: verdetti rivisti dall'utente

Quando l'utente vuole chiudere (o la sessione finisce), **proponi** senza scrivere nulla:

| Fonte | Verdetto | Capitoli | Motivazione (una riga) |
| ----- | -------- | -------- | ---------------------- |

Verdetti possibili: `all` (leggere tutto), `parts` (leggere i capitoli X, con `--chapters`), `skip` (non leggere), `undecided` (da decidere). Proponi anche una **sintesi** dell'esito (pochi paragrafi) e la voce di **diario** (cosa è emerso in questa sessione, cosa resta da vedere).

**Aspetta che l'utente li riveda e li approvi**, anche in parte. Solo dopo scrivi quello che ha approvato:

```bash
pnpm --silent explore verdict <id> --book <bookId> --decision parts --chapters 2,5 --reason "Una riga di motivazione." --via skill
pnpm --silent explore summary <id> --text-file - <<'EOF'
Sintesi dell'esito.
EOF
pnpm --silent explore journal <id> --via skill --text-file - <<'EOF'
Cosa è emerso, cosa resta da vedere.
EOF
pnpm --silent explore validate
```

- La voce di **diario** va scritta a ogni fine sessione, anche senza verdetti: è ciò che la chat dell'app legge per continuare.
- `pnpm --silent explore close <id>` solo se l'utente dice che l'esplorazione è finita (`reopen` per riaprirla).
- Alla fine ricorda all'utente che l'esplorazione si vede su `/explore/<id>` (e, dopo commit e push, sul sito pubblicato).

## Dati hosted (API del Pi)

Quando l'app è in hosting, le esplorazioni vivono su Turso e la CLI le raggiunge con il token dell'utente. Imposta nell'ambiente (in `.env.local` non basta: la CLI legge l'ambiente della shell) `EHUB_API_URL` (indirizzo dell'API) ed `EHUB_API_TOKEN` (nell'app, dopo l'accesso, il pulsante «Token CLI» lo copia; dura una settimana). Con le due variabili `pnpm --silent explore list|show|new|verdict|note|journal|summary` lavorano sui dati veri; senza, sui file locali. Il token è dell'utente: non stamparlo, non scriverlo in file, non metterlo in un comando visibile.

Restano locali al laptop i comandi che servono EPUB o Kobo (`prepare`, `kobo`, `add --epub`): il testo dei libri sta nella cache del Pi (`/var/cache/ehub/e-library`) e il Kobo si raggiunge solo da lì. Se servono, chiedi all'utente di lanciarli sul Pi o di usare la pagina dell'esplorazione nell'app.
