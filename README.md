# StudyLibrary

StudyLibrary è una piattaforma di studio **JSON-first** organizzata così:

**Utente → Catalogo → Librerie → Lezioni → Argomenti**

Un utente può tenere il proprio catalogo privato oppure pubblicarlo nella Home. Ogni libreria può contenere una o più lezioni; ogni lezione ha i propri topic, fonti, esempi, checkpoint e collegamenti.

## Funzioni principali

- Home con i **cataloghi pubblicati** dalla community.
- Area **Il mio catalogo** per contenuti privati/pubblici dell'utente.
- Librerie organizzate in **lezioni**, adatte a corsi universitari con slide separate per lezione.
- Reader progressivo per i topic della singola lezione.
- **Universo della lezione**, della libreria, del catalogo e Universo totale.
- Force graph fullscreen con ricerca, zoom, drag, focus e pannello nodo.
- Studio JSON con validazione, import/export, salvataggio privato e pubblicazione.
- Google Login via Supabase.
- Rating e commenti con Row Level Security.
- Docker/Nginx pronto per Coolify.
- Modalità demo senza backend.

## Esempio incluso

Il repository contiene:

```text
Catalogo: Computer Vision
└── Libreria: Computer Vision
    └── Lezione 01 — Introduction
        └── 12 argomenti
```

La lezione usa il JSON già presente in:

`data/courses/computer-vision-introduction.json`

e viene collegata dal manifest:

`data/catalogs/computer-vision.json`

Questo permette di aggiungere **una lezione alla volta** senza trasformare il catalogo in un unico file enorme.

## Aggiungere una nuova lezione da Git

1. Crea un JSON lezione, per esempio:
   `data/courses/computer-vision-lesson-02.json`
2. Apri:
   `data/catalogs/computer-vision.json`
3. Aggiungi alla libreria:

```json
{
  "id": "cv-lesson-02",
  "slug": "lesson-02",
  "title": "Lezione 02",
  "order": 2,
  "src": "/data/courses/computer-vision-lesson-02.json"
}
```

4. Commit + redeploy.

Lo schema completo è in `docs/CONTENT-SCHEMA.md`.

## Coolify

Build con il `Dockerfile`, porta interna `80`.

Per la sola modalità demo non servono variabili.

Per account e community:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
APP_URL=https://study.example.com
```

Poi esegui `supabase/schema.sql` e abilita Google OAuth in Supabase.

## Struttura

```text
data/
├── catalog.json                  # registry dei cataloghi locali
├── catalogs/
│   └── computer-vision.json      # catalogo -> librerie -> riferimenti alle lezioni
└── courses/
    └── computer-vision-introduction.json  # contenuto della singola lezione
```

Il database salva invece il catalogo espanso come JSONB, così può essere modificato e pubblicato direttamente dal browser.
