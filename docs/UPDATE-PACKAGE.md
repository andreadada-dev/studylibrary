# StudyLibrary incremental updates — Agent protocol v2

Il formato **`studylibrary.update`** serve a proporre piccole modifiche a cataloghi esistenti **senza esportare o rigenerare tutto il catalogo**. Un agente legge il contesto corrente tramite API e produce soltanto le operazioni richieste. La UI StudyLibrary applica queste operazioni a una copia, convalida l'intero risultato, mostra un diff, richiede conferma, poi salva una nuova versione con un controllo di concorrenza atomico.

## Da leggere prima di generare JSON

- Manifest AI: `GET https://study.ddone.it/api/v1/agent` (alias `/.well-known/studylibrary.json`)
- Schema verificabile: `GET /api/v1/schema/update-package`
- Stato e versione del catalogo: `GET /api/v1/catalogs/{catalog}/agent`
- Indice semantico leggero: `GET /api/v1/catalogs/{catalog}/context`
- Verifica qualità: `GET /api/v1/catalogs/{catalog}/audit`
- Grafo: `GET /api/v1/catalogs/{catalog}/graph`
- Lettura mirata: `GET /api/v1/catalogs/{catalog}/libraries/{library}/lessons/{lesson}/topics/{topic}`
- Scrittura autenticata: `POST /api/v1/write` (nota importante sotto)

La Knowledge API pubblica espone **soltanto** cataloghi/rami esplicitamente abilitati alla lettura API. Un catalogo nella Home non è automaticamente accessibile via API.

## Formato consigliato (v2)

```json
{
  "kind": "studylibrary.update",
  "schemaVersion": 2,
  "catalog": "uuid-catalogo",
  "baseVersion": 7,
  "message": "Aggiunta spiegazione su risoluzione spaziale",
  "operations": [
    {
      "op": "addSection",
      "library": "prima-libreria",
      "lesson": "lezione-01",
      "topic": "spatial-resolution",
      "beforeSectionId": "checkpoint-spatial",
      "value": {
        "id": "spatial-resolution-example-01",
        "type": "example",
        "title": "Esempio",
        "body": "Un'immagine 1920×1080 ha 2.073.600 pixel."
      }
    }
  ]
}
```

I valori di `catalog`, `library`, `lesson`, `topic` e `beforeSectionId` sono **illustrativi**, non identificatori reali. Recuperali dalle API prima di generare il pacchetto.

- `kind` è sempre `studylibrary.update`.
- `schemaVersion`: **2** per gli aggiornamenti granulari (i vecchi pacchetti **1** restano compatibili).
- `catalog`: UUID cloud preferito (supportati anche slug e ID JSON).
- `baseVersion`: obbligatorio; deve essere `currentVersion` del catalogo letto con `/agent`.
- `message`: breve descrizione della modifica, visibile nella cronologia versioni (max 240 caratteri).
- `operations`: almeno un'operazione; eseguite nell'ordine indicato, su una copia del catalogo.

## Operazioni v2 per cambiamenti mirati

| Operazione | Parametri obbligatori | Comportamento |
| --- | --- | --- |
| `addTopic` | `library`, `lesson`, `value` con ID | Aggiunge topic; fallisce se esiste. Opz. `module`, `moduleTitle` |
| `patchTopic` | `library`, `lesson`, `topic`, `changes` | Cambia solo campi espliciti |
| `addSection` | `library`, `lesson`, `topic`, `value` | Aggiunge sezione con ID unico e tipo |
| `updateSection` | `library`, `lesson`, `topic`, `changes`, selettore | Cambia solo i campi della sezione individuata |
| `removeSection` | `library`, `lesson`, `topic`, selettore | Elimina sezione; validazione mantiene i checkpoint |
| `addMedia` | `value` con `id`, `type`, `url` | Registra un asset nel catalogo |
| `updateMedia` | `media` (ID), `changes` | Aggiorna metadati/URL dell'asset, non ID/tipo |
| `removeMedia` | `media` (ID) | Fallisce se un topic fa ancora riferimento all'asset |
| `addSource` | `library`, `lesson`, `value` con `id` | Aggiunge fonte; opz. `topic`, `pages`, `note` per collegarla |
| `updateLesson` | `library`, `lesson`, `changes` | Cambia proprietà della lezione, senza riscrivere topic/moduli |
| `moveTopic` | `library`, `lesson`, `topic`, `toLesson` | Sposta il topic; opz. `toLibrary`, `module`, `moduleTitle` |

Restano supportati **in v1 e v2**: `upsertLesson`, `removeLesson`, `upsertTopic`, `removeTopic`, `addConnection`, `removeConnection`. **Attenzione:** gli upsert legacy sostituiscono l'intero oggetto preesistente (lezione o topic): non usarli per aggiungere soltanto una sezione.

### Modifica di alcuni campi

```json
{
  "op": "patchTopic",
  "library": "prima-libreria",
  "lesson": "lezione-01",
  "topic": "spatial-resolution",
  "changes": {
    "summary": "Definizione più precisa.",
    "estimatedMinutes": 14
  }
}
```

`patchTopic` ammette solo `title`, `summary`, `why`, `estimatedMinutes`, `learningGoals`, `prerequisites`, `api`. `updateLesson` ammette solo `title`, `description`, `estimatedMinutes`, `accent`, `api`.

Il patch è **shallow**: modifica esclusivamente i campi inviati, ma se passi un array (per esempio `learningGoals`) sostituisce **tutto quell'array**. Non usare i patch generici per sostituire `topics`, `sections`, `sources`, `modules`, `id` o `slug`. Per questi usa le operazioni mirate.

### Aggiungere una sezione senza rigenerare il topic

```json
{
  "op": "addSection",
  "library": "prima-libreria",
  "lesson": "lezione-01",
  "topic": "spatial-resolution",
  "afterSectionId": "intro",
  "value": {
    "id": "new-example-01",
    "type": "example",
    "title": "Un esempio pratico",
    "body": "..."
  }
}
```

La nuova sezione ha un **ID stabile e unico** dentro il topic. Puoi indicare **al massimo uno** tra `index` (zero-based), `beforeSectionId`, `afterSectionId`; senza selettore viene appesa in fondo.

Per **modificare o eliminare** una sezione esistente devi indicare **esattamente uno** tra `sectionId` (consigliato) e `sectionIndex` (zero-based). Le vecchie sezioni senza ID possono essere gestite con `sectionIndex`: recupera il topic completo subito prima di generare la modifica.

```json
{
  "op": "updateSection",
  "library": "prima-libreria",
  "lesson": "lezione-01",
  "topic": "spatial-resolution",
  "sectionIndex": 2,
  "changes": {
    "body": "Testo corretto, senza sostituire la formula o altre sezioni."
  }
}
```

`updateSection` non cambia mai `id` o `type`. `removeSection` usa lo stesso selettore. Il catalogo finale deve continuare a superare la validazione didattica (fonti, checkpoint, ecc.).

### Media con provenienza verificabile

```json
{
  "op": "addMedia",
  "value": {
    "id": "cv-gaussian-illustration",
    "type": "image",
    "url": "https://example.org/image.png",
    "alt": "Distribuzione del kernel gaussiano",
    "sourceUrl": "https://example.org/original",
    "credit": "Autore verificato"
  }
}
```

Successivamente usa `mediaRef: "cv-gaussian-illustration"` in una sezione `image`, oppure aggiungi l'immagine inline tramite `addSection`: StudyLibrary normalizza i media inline quando salva. Non inventare autori, licenze o URL delle slide. `removeMedia` non può eliminare un asset ancora utilizzato da sezioni o gallery.

### Fonti, lezioni e spostamenti

```json
{
  "op": "addSource",
  "library": "prima-libreria",
  "lesson": "lezione-01",
  "topic": "spatial-resolution",
  "value": {
    "id": "slides-lecture-01",
    "type": "slides",
    "label": "Slide della lezione"
  },
  "pages": "3–8",
  "note": "Spiegazione sulla risoluzione"
}
```

`addSource` registra la fonte nella lezione e, se viene specificato `topic`, aggiunge anche il riferimento alle sue fonti. Non duplica un ID già identico; rifiuta ID riutilizzati con dati differenti.

`moveTopic` mantiene il topic con il suo ID e ne cambia la posizione tra moduli/lezioni. Controlla le connessioni tra lezioni dopo uno spostamento.

## Regole fondamentali per agenti

1. Leggi `/agent`, `/context` e la `currentVersion` reale.
2. Leggi solo i topic/lezioni necessari. Mai inventare ID o selettori.
3. Analizza le fonti consegnate dall'utente; conserva terminologia, slide e pagine. Ricerca esterna solo se richiesta o utile, sempre distinta dalla fonte.
4. Preferisci `patchTopic`, `addSection`, `updateSection`, `addSource` a `upsertTopic` quando il topic esiste.
5. Non modificare materiale non coinvolto; se manca una fonte, segnalalo.
6. Non eliminare contenuti senza richiesta esplicita.
7. Restituisci **un piccolo JSON**, con `schemaVersion:2`, `baseVersion` e un messaggio significativo.
8. Controlla audit, collegamenti e prerequisiti dopo il merge.

## Importazione, versione e sicurezza

1. L'utente trascina il file `*.json` in **Il mio catalogo**.
2. StudyLibrary controlla la versione, applica tutte le operazioni a una copia e valida il risultato.
3. Mostra un diff e chiede conferma.
4. Dopo conferma, il browser invia lo snapshot completo risultante alla funzione Supabase `studylibrary_api_write` con `p_base_version` e il JWT dell'**utente proprietario**.
5. La funzione applica un blocco sulla riga e confronta la versione prima di scrivere. Se un altro dispositivo ha salvato nel frattempo, rifiuta con `version_conflict`. Nessun overwrite silenzioso.
6. L'aggiornamento riuscito crea una nuova versione immutabile.

**Nota:** `/api/v1/write` continua a richiedere, internamente, lo **snapshot intero**. Questo NON è un endpoint che accetta direttamente il piccolo pacchetto. Lo scambio fra ChatGPT e l'utente rimane piccolo; è StudyLibrary a fare il merge prima della scrittura. Non inserire token JWT o credenziali nel file JSON e non condividerli in chat.

### Retrocompatibilità

Il formato `schemaVersion:1` e le sue sei operazioni originali continuano a essere accettati. Passa a `schemaVersion:2` per tutte le nuove modifiche granulari.
