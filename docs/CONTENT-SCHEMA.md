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
