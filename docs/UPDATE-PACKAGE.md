# StudyLibrary Update Package

Un update package permette di aggiornare un catalogo esistente senza scambiare ogni volta l'intero JSON.

È pensato soprattutto per il workflow:

```text
StudyLibrary /context
        ↓
nuove slide
        ↓
ChatGPT genera update package
        ↓
drag & drop in Il mio catalogo
        ↓
diff
        ↓
conferma
        ↓
nuova versione
```

## Formato

```json
{
  "kind": "studylibrary.update",
  "schemaVersion": 1,
  "catalog": "UUID-o-slug-catalogo",
  "baseVersion": 7,
  "message": "Aggiunta Lezione 04 e collegamenti con convolution",
  "operations": []
}
```

### catalog

Può essere:

- UUID cloud del catalogo;
- slug del catalogo;
- id JSON del catalogo.

L'UUID è preferibile perché stabile e non ambiguo.

### baseVersion

Versione sulla quale è stato preparato il pacchetto.

Se StudyLibrary è già a una versione diversa, l'import viene bloccato per evitare di sovrascrivere modifiche recenti.

### message

Diventa il messaggio della nuova versione.

## Operazioni

### upsertLesson

Aggiunge una nuova lezione oppure sostituisce quella con lo stesso `slug` / `id`.

```json
{
  "op": "upsertLesson",
  "library": "computer-vision",
  "value": {
    "schemaVersion": 1,
    "id": "lesson-04",
    "slug": "lesson-04-filtering",
    "title": "Lezione 04 — Filtering",
    "description": "...",
    "modules": [],
    "topics": [],
    "sources": []
  }
}
```

### removeLesson

```json
{
  "op": "removeLesson",
  "library": "computer-vision",
  "lesson": "lesson-04-filtering"
}
```

### upsertTopic

Aggiunge o sostituisce un topic dentro una lezione.

```json
{
  "op": "upsertTopic",
  "library": "computer-vision",
  "lesson": "lesson-04-filtering",
  "module": "filtri",
  "moduleTitle": "Filtri",
  "value": {
    "id": "gaussian-filter",
    "title": "Gaussian Filter",
    "summary": "...",
    "why": "...",
    "estimatedMinutes": 12,
    "prerequisites": ["convolution"],
    "learningGoals": ["..."],
    "sections": [
      {
        "type": "concept",
        "title": "Idea chiave",
        "body": "..."
      },
      {
        "type": "checkpoint",
        "question": "...?",
        "answer": "..."
      }
    ],
    "connections": [],
    "sources": [
      {
        "ref": "slides-04",
        "pages": "8-13",
        "note": "..."
      }
    ]
  }
}
```

Se il modulo indicato non esiste, viene usato il primo modulo. Se non esiste alcun modulo ne viene creato uno.

### removeTopic

```json
{
  "op": "removeTopic",
  "library": "computer-vision",
  "lesson": "lesson-04-filtering",
  "topic": "gaussian-filter"
}
```

StudyLibrary rimuove anche il topic dai moduli e pulisce i riferimenti interni più diretti.

### addConnection

```json
{
  "op": "addConnection",
  "library": "computer-vision",
  "lesson": "lesson-04-filtering",
  "from": "gaussian-filter",
  "connection": {
    "target": "convolution",
    "type": "uses",
    "label": "Il filtro gaussiano viene applicato tramite convoluzione"
  }
}
```

Le connessioni duplicate non vengono aggiunte due volte.

### removeConnection

```json
{
  "op": "removeConnection",
  "library": "computer-vision",
  "lesson": "lesson-04-filtering",
  "from": "gaussian-filter",
  "target": "convolution",
  "type": "uses"
}
```

`type` è opzionale: se omesso vengono rimosse le connessioni verso quel target.

## Validazione

Prima dell'applicazione definitiva StudyLibrary:

1. controlla `baseVersion`;
2. applica le operazioni su una copia in memoria;
3. valida il catalogo risultante;
4. mostra un diff sintetico;
5. chiede conferma;
6. salva il catalogo;
7. crea automaticamente una nuova versione.

Il pacchetto originale non modifica direttamente il database.

## Prompt consigliato

Quando chiedi a ChatGPT di aggiornare StudyLibrary puoi usare una richiesta del tipo:

> Leggi il context pubblico del mio catalogo StudyLibrary e le lezioni necessarie. Analizza queste nuove slide. Restituiscimi un file `studylibrary.update` basato sulla currentVersion corrente, aggiungendo soltanto le nuove lezioni/topic e le connessioni utili con ciò che esiste già.

In questo modo il modello non deve rigenerare l'intero catalogo e il merge rimane verificabile.
