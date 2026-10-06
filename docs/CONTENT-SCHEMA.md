# StudyLibrary Content Schema

## Gerarchia

StudyLibrary usa questa gerarchia:

```text
Utente
└── Catalogo
    ├── Libreria
    │   ├── Lezione
    │   │   ├── Argomento
    │   │   └── Argomento
    │   └── Lezione
    └── Libreria
```

Il **Catalogo** è l'unità di pubblicazione. Può essere privato oppure pubblico nella Home.

Una **Libreria** rappresenta normalmente un corso o un'area coerente.

Una **Lezione** corrisponde idealmente a una lezione del docente, a un PDF o a un gruppo preciso di slide.

Gli **Argomenti** sono le unità didattiche vere e proprie.

## Manifest del catalogo

I cataloghi locali vivono in `data/catalogs/`.

Esempio:

```json
{
  "schemaVersion": 2,
  "id": "computer-vision-catalog",
  "slug": "computer-vision",
  "title": "Computer Vision",
  "description": "Catalogo di studio",
  "visibility": "public",
  "libraries": [
    {
      "id": "computer-vision",
      "slug": "computer-vision",
      "title": "Computer Vision",
      "description": "Corso organizzato per lezioni",
      "lessons": [
        {
          "id": "cv-lesson-01",
          "slug": "lesson-01-introduction",
          "title": "Lezione 01 — Introduction",
          "order": 1,
          "src": "/data/courses/computer-vision-introduction.json"
        }
      ]
    }
  ]
}
```

### Perché `src`

Nel repository è consigliato tenere ogni lezione in un JSON separato.

Così puoi aggiungere progressivamente:

```text
computer-vision-lesson-01.json
computer-vision-lesson-02.json
computer-vision-lesson-03.json
...
```

senza modificare un file gigantesco.

Quando il catalogo viene salvato nel database, il contenuto può essere memorizzato già espanso come JSONB.

## JSON della singola lezione

Una lezione mantiene la struttura didattica:

```json
{
  "schemaVersion": 1,
  "id": "cv-lesson-02",
  "slug": "lesson-02",
  "title": "Lezione 02",
  "description": "Descrizione",
  "sources": [],
  "modules": [
    {
      "id": "fondamenti",
      "title": "Fondamenti",
      "topicIds": ["topic-a"]
    }
  ],
  "topics": [
    {
      "id": "topic-a",
      "title": "Titolo",
      "summary": "Cosa capisco dopo questa sezione.",
      "why": "Perché serve.",
      "estimatedMinutes": 10,
      "prerequisites": [],
      "learningGoals": ["Obiettivo verificabile"],
      "sections": [
        {
          "type": "lead",
          "body": "Intuizione iniziale."
        },
        {
          "type": "concept",
          "title": "Idea chiave",
          "body": "Spiegazione progressiva."
        },
        {
          "type": "checkpoint",
          "question": "Domanda di verifica?",
          "answer": "Risposta."
        }
      ],
      "connections": [],
      "sources": [
        {
          "ref": "slide-02",
          "pages": "3–5",
          "note": "Fonte di questo argomento."
        }
      ]
    }
  ]
}
```

## Must-have per ogni argomento

Ogni topic deve avere:

1. **Perché serve**
2. **Prerequisiti**
3. **Intuizione**
4. **Spiegazione**
5. **Esempio, visuale, confronto o formula** quando utile
6. **Checkpoint**
7. **Fonti**
8. **Connessioni**

Non trasformare le slide in una trascrizione.

## Tipi di blocco

Sono supportati:

- `lead`
- `concept`
- `text`
- `example`
- `callout`
- `formula`
- `image`
- `flow`
- `comparison`
- `list`
- `checkpoint`

### Immagini

```json
{
  "type": "image",
  "src": "https://example.org/image.png",
  "alt": "Descrizione accessibile",
  "caption": "Cosa deve osservare lo studente",
  "credit": "Fonte"
}
```

## Collegamenti

### Stessa lezione

```json
{
  "target": "spatial-resolution",
  "type": "requires",
  "label": "Serve per capire il campionamento"
}
```

### Altra lezione della stessa libreria

```json
{
  "target": "lesson-03/fourier-transform",
  "type": "enables"
}
```

### Altra libreria dello stesso catalogo

```json
{
  "target": "numerical-methods/lesson-02/interpolation",
  "type": "related"
}
```

### Altro catalogo

```json
{
  "target": "physics/electromagnetism/gauss-law/symmetry",
  "type": "related"
}
```

Tipi consigliati:

`requires`, `enables`, `uses`, `related`, `contrasts`, `motivates`, `applies-to`.

## Universi

La stessa struttura alimenta quattro viste:

- **Universo lezione** → lezione + argomenti
- **Universo libreria** → libreria + lezioni + argomenti
- **Universo catalogo** → catalogo + librerie + lezioni + argomenti
- **Universo totale** → tutti i cataloghi accessibili all'utente

## Pubblicazione

`visibility: "private"` significa catalogo personale.

`visibility: "public"` significa catalogo pubblicato nella Home.

Con Supabase, la sicurezza non dipende dal JSON ma dalle policy RLS definite in `supabase/schema.sql`.


## Accesso API

La visibilità nella Home e l'accesso API sono separati.

Sul catalogo:

```json
{
  "visibility": "private",
  "api": {
    "publicRead": true
  }
}
```

In questo esempio il catalogo non compare nella Home, ma può essere letto tramite la Knowledge API.

Librerie, lezioni e topic possono avere un override:

```json
{
  "api": {
    "publicRead": false
  }
}
```

Se `api.publicRead` manca, il valore viene ereditato dal genitore. Un genitore privato rende privati anche tutti i discendenti.

Esempio:

```json
{
  "slug": "computer-vision",
  "title": "Computer Vision",
  "api": { "publicRead": true },
  "lessons": [
    {
      "slug": "lesson-01",
      "api": { "publicRead": true }
    },
    {
      "slug": "lesson-private-notes",
      "api": { "publicRead": false }
    }
  ]
}
```

La documentazione completa degli endpoint è in `docs/API.md`.

## Versioning cloud

Il numero di versione non va scritto a mano nel JSON.

Quando il catalogo è salvato su Supabase, il database mantiene:

- `current_version`;
- snapshot immutabili in `catalog_versions`;
- messaggio della versione;
- timestamp.

Questo permette di continuare a usare JSON portabili senza inserire metadati runtime nel formato didattico.


## Media: immagini e video

Un catalogo può avere una libreria media riutilizzabile:

```json
{
  "media": [
    {
      "id": "image-pinhole-model",
      "type": "image",
      "url": "https://example.org/pinhole.png",
      "title": "Pinhole camera model",
      "caption": "Geometria della proiezione prospettica",
      "alt": "Schema di una camera pinhole con piano immagine",
      "sourceUrl": "https://example.org/article",
      "author": "Autore",
      "license": "CC BY 4.0",
      "provider": "Example"
    },
    {
      "id": "video-color-spaces",
      "type": "video",
      "url": "https://www.youtube.com/watch?v=...",
      "title": "Color spaces explained",
      "caption": "Introduzione visuale agli spazi colore",
      "sourceUrl": "https://www.youtube.com/watch?v=...",
      "provider": "youtube"
    }
  ]
}
```

Le sezioni dei topic possono poi referenziare i media:

```json
{
  "type": "image",
  "mediaRef": "image-pinhole-model",
  "caption": "Osserva il rapporto fra punto 3D, centro ottico e piano immagine."
}
```

```json
{
  "type": "video",
  "mediaRef": "video-color-spaces"
}
```

Sono inoltre supportate:

```json
{
  "type": "gallery",
  "title": "Confronto visuale",
  "items": [
    "image-rgb",
    "image-hsv"
  ]
}
```

e risorse esterne non embeddabili:

```json
{
  "type": "embed",
  "title": "Demo interattiva",
  "url": "https://example.org/demo",
  "body": "Apri la demo e modifica i parametri."
}
```

### URL diretto e auto-registrazione

Per immagini e video puoi anche inserire direttamente l'URL:

```json
{
  "type": "image",
  "url": "https://example.org/diagram.png",
  "alt": "Descrizione accessibile",
  "sourceUrl": "https://example.org/source",
  "license": "CC BY 4.0"
}
```

Quando il catalogo viene salvato, StudyLibrary:

1. genera un ID stabile dal tipo + URL;
2. deduplica il media;
3. lo aggiunge a `catalog.media`;
4. sostituisce l'URL inline con `mediaRef`.

Lo stesso avviene con URL inseriti nelle gallery.

### Video

Il renderer gestisce in modo specifico:

- YouTube → embed privacy-enhanced `youtube-nocookie.com`;
- Vimeo → player Vimeo;
- URL diretti a video → elemento HTML `video`;
- altri URL → link esterno con thumbnail quando disponibile.

Non vengono creati iframe arbitrari da URL non riconosciuti.

### Provenienza

Per media trovati sul web, compilare quando possibile:

- `sourceUrl`: pagina originale, non soltanto il file immagine;
- `author` / `credit`;
- `license`;
- `provider`.

Non inventare mai la licenza. Se non è verificabile, lasciala vuota oppure usa un valore esplicito come `unknown`.

Le immagini devono avere un `alt` utile alla comprensione.

L'audit API segnala media senza URL, immagini senza alt, media senza fonte/licenza e riferimenti `mediaRef` rotti.
