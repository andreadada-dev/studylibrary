# StudyLibrary Content Schema

StudyLibrary è **JSON-first**. Un corso può vivere come file versionato in Git oppure come `jsonb` in Supabase. Il renderer usa la stessa struttura in entrambi i casi.

## Principio editoriale

Una pagina non deve essere una trascrizione delle slide. Ogni topic deve rispondere, in quest'ordine, a cinque domande:

1. **Perché mi serve?** — motivazione concreta.
2. **Cosa devo già sapere?** — prerequisiti come ID di topic.
3. **Qual è l'intuizione?** — modello mentale prima delle definizioni.
4. **Come funziona davvero?** — formalismo, esempio, formula, immagine o confronto.
5. **Ho capito?** — almeno un checkpoint con risposta.

Le relazioni non vanno lasciate nel testo: se sapere A serve per B, aggiungi un arco esplicito.

## Struttura minima del corso

```json
{
  "schemaVersion": 1,
  "id": "course-id",
  "slug": "course-slug",
  "title": "Titolo",
  "description": "Cosa imparerai e perché conta.",
  "language": "it",
  "visibility": "private",
  "tags": ["tag"],
  "sources": [],
  "modules": [
    {
      "id": "module-id",
      "title": "Modulo",
      "topicIds": ["topic-a"]
    }
  ],
  "topics": []
}
```

## Must-have di ogni topic

```json
{
  "id": "topic-a",
  "title": "Titolo leggibile",
  "summary": "Una frase: che cosa capisco dopo questa pagina?",
  "why": "Perché questo concetto è utile nel corso o in un problema reale.",
  "estimatedMinutes": 10,
  "prerequisites": [],
  "learningGoals": [
    "Obiettivo verificabile 1",
    "Obiettivo verificabile 2"
  ],
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
      "question": "Domanda di controllo?",
      "answer": "Risposta breve e verificabile."
    }
  ],
  "connections": [],
  "sources": [
    {
      "ref": "source-id",
      "pages": "12–14",
      "note": "Cosa supporta questa fonte."
    }
  ]
}
```

## Tipi di sezione supportati

### `lead`
Apre l'argomento con una spiegazione intuitiva. Evita definizioni fredde come prima frase.

```json
{ "type": "lead", "body": "..." }
```

### `concept`, `text`, `example`
Testo principale. `body` può essere stringa o array di paragrafi. Puoi aggiungere `items`.

```json
{
  "type": "concept",
  "title": "Idea chiave",
  "body": "...",
  "items": ["...", "..."]
}
```

### `callout`
Solo per informazione con funzione precisa: warning, nota d'esame, intuizione cruciale. Non usarlo come decorazione.

```json
{
  "type": "callout",
  "tone": "warning",
  "title": "Attenzione",
  "body": "..."
}
```

Toni: `info`, `warning`, `success`.

### `formula`
Supporta LaTeX/KaTeX.

```json
{
  "type": "formula",
  "title": "Legge",
  "latex": "F = ma",
  "note": "Definisci sempre i simboli."
}
```

### `image`
L'immagine può essere locale (`/assets/...`) o remota HTTPS.

```json
{
  "type": "image",
  "src": "https://example.org/figure.png",
  "alt": "Descrizione accessibile",
  "caption": "Cosa deve notare lo studente",
  "credit": "Fonte / autore"
}
```

Regole: usa sempre `alt`; non hotlinkare immagini senza permesso; preferisci fonti universitarie, documentazione ufficiale o asset propri.

### `flow`
Piccola mappa lineare, utile per pipeline e catene causali.

```json
{
  "type": "flow",
  "title": "Pipeline",
  "nodes": ["A", "B", "C"]
}
```

### `comparison`
Due concetti da confrontare senza creare due card decorative separate.

```json
{
  "type": "comparison",
  "title": "A vs B",
  "left": { "title": "A", "body": "..." },
  "right": { "title": "B", "body": "..." }
}
```

### `list`
Lista concettuale breve.

```json
{ "type": "list", "title": "Ricorda", "items": ["...", "..."] }
```

### `checkpoint`
Obbligatorio almeno una volta per topic.

```json
{
  "type": "checkpoint",
  "question": "...",
  "answer": "..."
}
```

## Collegamenti tra argomenti

`prerequisites` indica dipendenze forti. Se `gauss-law` richiede `symmetry`, scrivi:

```json
{
  "id": "gauss-law",
  "prerequisites": ["symmetry"]
}
```

`connections` indica relazioni semantiche aggiuntive:

```json
{
  "connections": [
    {
      "target": "electric-field",
      "type": "uses",
      "label": "Il teorema collega flusso e campo elettrico"
    },
    {
      "target": "another-course/fourier-transform",
      "type": "related",
      "label": "Collegamento cross-course"
    }
  ]
}
```

Tipi raccomandati: `requires`, `enables`, `uses`, `related`, `contrasts`, `motivates`, `applies-to`.

Non duplicare archi senza motivo. Un prerequisito è già una relazione.

## Fonti

Il corso definisce una bibliografia riutilizzabile:

```json
{
  "sources": [
    {
      "id": "book-1",
      "type": "book",
      "label": "Titolo",
      "url": "https://..."
    }
  ]
}
```

Ogni topic cita gli ID pertinenti e, quando esistono, pagine o sezioni. Se una spiegazione amplia una slide con materiale esterno, aggiungi una seconda fonte invece di far sembrare che la slide lo dicesse.

## Checklist prima di pubblicare

- Titolo e summary comprensibili senza aprire le slide.
- `why` concreto, non generico.
- Prerequisiti espliciti.
- Almeno un visuale, esempio o confronto per i concetti non banali.
- Formule con simboli spiegati.
- Almeno un checkpoint.
- Almeno una fonte.
- Connessioni coerenti e senza target inesistenti.
- Immagini con alt text e credito.
- Nessun paragrafo enorme usato per sostituire una struttura didattica.
