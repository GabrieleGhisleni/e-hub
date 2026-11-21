# Task: trascrizioni podcast persistenti e per utente

## Obiettivo

Portare il flusso podcast sulla modalità hosted: metadati, appunti, conversazioni e trascrizioni devono essere salvati nel database, associati all'utente autenticato. Il computer può essere usato per calcolare una trascrizione, ma non deve esserne l'unica copia persistente. Una trascrizione non deve mai finire nei dati pubblici, nel bundle statico o nei dati di un altro utente.

## Flusso di aggiunta

Quando si aggiunge un episodio podcast, dopo averne verificato i metadati l'interfaccia chiede come ottenere la trascrizione:

1. **API** — il backend scarica/ottiene l'audio e chiama il provider configurato usando chiavi conservate solo sul server. Il provider e il modello effettivi vengono registrati nei metadati della trascrizione.
2. **Locale** — il computer dell'utente esegue la trascrizione con il modello e gli strumenti locali disponibili. La UI mostra stato e avanzamento; al termine carica il risultato al backend autenticato, che lo valida e lo salva nel database dell'utente. La trascrizione non resta legata al disco del computer.
3. **Copia e incolla** — l'utente seleziona la fonte del testo (almeno **AskChannel**, con possibilità di aggiungere altre fonti) e incolla o importa il contenuto. Per AskChannel si accetta il JSON esportato dal sito, come quello già disponibile nei Downloads: `video_id`, `video_title`, `video_url`, `published_at`, `segment_count`, `segments` con `start`, `end`, `text`. Il parser deve anche supportare i formati di testo aggiunti esplicitamente in futuro; non deve assumere che ogni input sia JSON AskChannel.

La selezione della fonte è distinta dalla modalità di elaborazione: ad esempio, “copia e incolla → AskChannel” registra AskChannel come origine, mentre “API → Groq” registra il provider/modello usato. Offrire un'opzione per aggiungere l'episodio senza trascrizione, se l'utente lo desidera.

## Formato canonico

- Normalizzare ogni input nello schema transcript condiviso dal pacchetto podcast.
- Conservare timestamp disponibili (inizio e, se lo schema viene esteso, fine segmento), testo, capitoli e speaker quando presenti. Se una fonte non fornisce tempi, dichiararlo nei metadati e non inventare precisione; se serve compatibilità con lo schema corrente, usare tempi stimati/assenti in modo esplicito.
- Registrare origine (`askchannel`, `api`, `local` o altra fonte), URL della fonte quando disponibile, provider/modello quando applicabile, `timebase` (`youtube` o `feed` quando determinabile), data d'importazione e versione del parser.
- Validare con Zod al confine API. Rifiutare ID YouTube o URL discordanti rispetto all'episodio, segmenti malformati e file oltre limiti configurabili; mostrare un errore comprensibile senza salvare dati parziali.

## Persistenza e isolamento

- Salvare la trascrizione in una tabella/record persistente keyed da `(user_id, episode_id)` (oppure relazione equivalente), con schema versionato. Evitare che il testo venga copiato nei JSON del repo o nelle build statiche.
- Tutte le letture, scritture, sostituzioni e cancellazioni devono passare dall'API autenticata e filtrare per utente nello storage layer. Nessun endpoint deve consentire di accedere alla trascrizione di un altro account modificando l'ID.
- L'aggiunta episodio e trascrizione deve essere coerente: niente episodio “con trascrizione” se il salvataggio del testo fallisce. Definire una transazione o una procedura di recupero idempotente.
- Il database hosted è la copia persistente: cambiare computer, svuotare cache o reinstallare il client non deve perdere la trascrizione. La cache locale è opzionale e ricostruibile.
- Aggiornare migrazioni, validatori, esportazione/backup e cancellazione episodio affinché includano la nuova relazione. Tenere il contenuto privato dell'utente e fuori dal sito pubblico.

## Sicurezza e costi

- Le chiavi dei provider restano esclusivamente sul backend; non esporle a browser, log o bundle.
- Prima dell'invio a provider esterni, indicare quale servizio riceverà l'audio e usare le credenziali configurate dall'utente/server secondo le policy del progetto.
- La modalità locale non deve richiedere una chiave API per l'inferenza; se richiede download di modelli o dipendenze, mostrarne requisiti e spazio previsto.
- Rendere visibili stato, avanzamento, errori e possibilità di riprendere un job interrotto. Evitare doppie trascrizioni per richieste ripetute (idempotency key o controllo di versione).

## UX

- Presentare le tre scelte con descrizione breve di privacy, costo/uso delle chiavi e requisiti.
- Per copia e incolla, chiedere la fonte prima dell'input e mostrare un'anteprima di titolo, video ID, numero segmenti, timestamp e testo iniziale; permettere di confermare o correggere l'associazione all'episodio.
- Dopo l'import, mostrare origine, modalità, stato e disponibilità della trascrizione su altri dispositivi.
- Permettere di sostituire o rimuovere una trascrizione con conferma e controllo di versione; l'eliminazione episodio deve eliminare anche la trascrizione associata.

## Criteri di completamento

- Una trascrizione importata da AskChannel è normalizzata, validata e disponibile dopo logout/login e da un secondo dispositivo dello stesso account.
- Un altro utente non può leggere, sovrascrivere o cancellare quella trascrizione, anche conoscendo l'ID episodio.
- API e inferenza locale producono lo stesso formato canonico e salvano il risultato persistente nel database dell'utente.
- Le credenziali non compaiono nel client o nei log; gli errori e le interruzioni non lasciano record incoerenti.
- Nessun testo di trascrizione viene pubblicato nel catalogo statico o incluso nel repository.
- Aggiornare la documentazione podcast, lo schema e le istruzioni di hosting eliminando le indicazioni obsolete che presentano le trascrizioni come solo file locali.
- Aggiungere test di parser AskChannel, validazione, isolamento multiutente, idempotenza, fallimento parziale e flusso di upload locale.
