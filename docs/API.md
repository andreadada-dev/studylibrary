# StudyLibrary Knowledge API v1

## Agent bootstrap

Prima di lavorare su StudyLibrary un agente può leggere:

```text
GET https://study.ddone.it/api/v1/agent
```

Alias standard:

```text
GET https://study.ddone.it/.well-known/studylibrary.json
```

Il documento è versionato insieme all'app e descrive:

- gerarchia Catalogo → Libreria → Lezione → Topic;
- endpoint disponibili;
- schema dei JSON;
- must-have didattici;
- policy sulle fonti;
- tipi di connessione;
- workflow consigliato;
- formato `studylibrary.update`;
- regole di versioning e concorrenza.

Per uno specifico catalogo API-public:

```text
GET /api/v1/catalogs/{catalog-id}/agent
GET /api/v1/catalogs/{catalog-id}/audit
```

`/agent` restituisce currentVersion, statistiche, endpoint canonici, audit summary e l'ordine di lettura consigliato.

`/audit` controlla automaticamente qualità strutturale e didattica dei contenuti esposti: fonti, checkpoint, obiettivi, collegamenti, prerequisiti, topic orfani e riferimenti rotti.

Gli schema machine-readable sono disponibili in:

```text
/api/v1/schema/catalog
/api/v1/schema/lesson
/api/v1/schema/topic
/api/v1/schema/update-package
```


StudyLibrary espone i cataloghi che il proprietario abilita esplicitamente all'API.

La pubblicazione nella Home e la pubblicazione API sono indipendenti:

- `visibility = public` / `is_public = true` → catalogo visibile nella Home;
- `api.publicRead = true` / `api_public = true` → catalogo leggibile dalla Knowledge API.

Un catalogo può quindi restare fuori dalla Home ma essere leggibile da agenti, script o altri strumenti.

## Base URL

Produzione:

```text
https://study.ddone.it/api/v1
```

La lettura pubblica non richiede token.

## Endpoint pubblici

### Elenco cataloghi API-public

```http
GET /api/v1/catalogs
```

### Catalogo completo filtrato

```http
GET /api/v1/catalogs/{catalog-id-or-slug}
GET /api/v1/catalogs/{catalog-id-or-slug}/export
```

Per integrazioni stabili è consigliato usare l'UUID del catalogo. Lo slug è supportato per comodità, ma può essere uguale tra proprietari diversi.

### Context compatto per AI

```http
GET /api/v1/catalogs/{catalog-id-or-slug}/context
```

Restituisce catalogo, librerie, lezioni e topic senza le sezioni didattiche complete. Per ogni topic mantiene soprattutto:

- id;
- titolo;
- summary;
- why;
- estimatedMinutes;
- prerequisites;
- connections.

È l'endpoint consigliato per capire rapidamente cosa esiste già prima di generare una nuova lezione.

### Grafo

```http
GET /api/v1/catalogs/{catalog-id-or-slug}/graph
```

Restituisce:

```json
{
  "nodes": [],
  "links": []
}
```

Include nodi Catalogo, Libreria, Lezione e Topic, più gli archi gerarchici e le connessioni dichiarate nei topic.

### Librerie

```http
GET /api/v1/catalogs/{catalog}/libraries
GET /api/v1/catalogs/{catalog}/libraries/{library}
```

### Lezioni

```http
GET /api/v1/catalogs/{catalog}/libraries/{library}/lessons
GET /api/v1/catalogs/{catalog}/libraries/{library}/lessons/{lesson}
```

### Topic

```http
GET /api/v1/catalogs/{catalog}/libraries/{library}/lessons/{lesson}/topics
GET /api/v1/catalogs/{catalog}/libraries/{library}/lessons/{lesson}/topics/{topic}
```

### Versioni pubbliche

```http
GET /api/v1/catalogs/{catalog}/versions
GET /api/v1/catalogs/{catalog}/versions/{version}
```

Una versione storica viene esposta solo se quella versione era API-public.

### Cambiamenti da una versione

```http
GET /api/v1/catalogs/{catalog}/changes/{version}
```

Risposta:

```json
{
  "fromVersion": 4,
  "toVersion": 7,
  "data": {
    "added": [],
    "changed": [],
    "removed": []
  }
}
```

Il confronto usa path stabili:

```text
library:<slug>/lesson:<slug>/topic:<id>
```

## Ereditarietà della visibilità API

Il catalogo deve avere:

```json
{
  "api": {
    "publicRead": true
  }
}
```

Librerie, lezioni e topic possono opzionalmente specificare:

```json
{
  "api": {
    "publicRead": false
  }
}
```

Se il campo manca, il nodo eredita dal genitore.

Regola di sicurezza:

```text
Catalogo API OFF
└── tutto privato

Catalogo API ON
├── Libreria senza override → pubblica
├── Libreria API false → libreria e discendenti privati
└── Libreria pubblica
    ├── Lezione senza override → pubblica
    └── Lezione API false → privata
```

Un discendente non può riaprire un genitore già privato.

## Versioning

Ogni modifica significativa a un catalogo cloud crea automaticamente uno snapshot immutabile:

```text
v1 → v2 → v3 → v4
```

Una versione contiene:

- catalog JSON;
- titolo/descrizione/tag;
- stato Home pubblico/privato;
- stato API pubblico/privato;
- messaggio della versione;
- timestamp.

Il ripristino di una versione non cancella la storia: crea una nuova versione contenente quello snapshot.

## Scrittura autenticata

Endpoint:

```http
POST /api/v1/write
Authorization: Bearer <SUPABASE_ACCESS_TOKEN_UTENTE>
Content-Type: application/json
```

Body:

```json
{
  "p_catalog_id": "UUID-CATALOGO",
  "p_base_version": 7,
  "p_message": "Aggiunta Lezione 04 e collegamenti con convolution",
  "p_catalog": {
    "...": "catalogo completo aggiornato"
  },
  "p_publish": null,
  "p_api_public": true
}
```

`p_base_version` abilita optimistic concurrency. Se il catalogo è stato aggiornato nel frattempo, il server rifiuta la scrittura con `version_conflict`.

`p_publish = null` mantiene lo stato Home corrente.

`p_api_public = null` usa `api.publicRead` dal JSON o mantiene lo stato attuale.

L'endpoint controlla sempre che il JWT appartenga al proprietario del catalogo.

## Workflow consigliato per agenti / ChatGPT

Per aggiornare una nuova lezione senza perdere il contesto del corso:

```text
1. GET /context
2. GET dei topic/lezioni necessari
3. analisi delle nuove slide
4. generazione del JSON aggiornato
5. confronto con currentVersion
6. POST /api/v1/write con baseVersion
7. nuova versione automatica
```

Per un flusso manuale:

```text
1. GET /context
2. generazione di uno o più JSON
3. trascina JSON in "Il mio catalogo"
4. StudyLibrary mostra il diff
5. conferma
6. viene creato uno snapshot/versione nuova
```

## Sicurezza

- lettura pubblica: solo contenuti esplicitamente API-public;
- scrittura: JWT Supabase dell'utente proprietario;
- la Publishable Key viene usata dal proxy Nginx ed è pubblica per definizione;
- service-role key, DB password e Google Client Secret non sono esposti;
- i contenuti nascosti a livello libreria/lezione/topic vengono rimossi dal JSON restituito;
- i riferimenti interni a topic nascosti vengono filtrati quando possibile.


## Update package

Per aggiornamenti incrementali tramite file JSON usa il formato `studylibrary.update`.

Specifica completa:

`docs/UPDATE-PACKAGE.md`

Il pacchetto include `baseVersion`, quindi StudyLibrary blocca automaticamente un aggiornamento preparato su una versione vecchia.


### Validazione delle scritture

La validazione non è affidata soltanto al browser. `/api/v1/write` valida server-side struttura minima, limiti di dimensione, checkpoint e fonti prima di aggiornare il catalogo. Lo slug del catalogo è trattato come identità stabile e non può essere cambiato tramite l'endpoint di scrittura.


## Media enrichment

Il catalog JSON può contenere `catalog.media[]` con asset `image` e `video`.

Gli agent dovrebbero:

1. usare media solo quando migliorano davvero la spiegazione;
2. preferire `mediaRef` per riutilizzare lo stesso asset;
3. preservare `sourceUrl`, autore/credito e licenza quando verificabili;
4. non inventare informazioni di licenza;
5. usare alt text descrittivo per le immagini.

È possibile inserire URL direttamente dentro sezioni `image`, `video` e `gallery`: al salvataggio il frontend li deduplica e li registra automaticamente in `catalog.media`.

L'API pubblica restituisce soltanto gli asset media referenziati dai contenuti effettivamente API-public, evitando che un media usato esclusivamente in una lezione privata venga esposto dal registry del catalogo.
