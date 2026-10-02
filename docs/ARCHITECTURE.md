# Architecture

## Gerarchia del prodotto

StudyLibrary usa una gerarchia esplicita:

```text
Utente
└── Catalogo
    ├── Libreria
    │   ├── Lezione
    │   │   └── Argomenti
    │   └── Lezione
    └── Libreria
```

Il catalogo è l'unità di proprietà e pubblicazione. Le librerie organizzano corsi o aree di studio; le lezioni seguono il materiale del docente; gli argomenti sono le unità didattiche.

## Frontend

- HTML, CSS e JavaScript ES modules.
- Nginx statico in produzione.
- Nessun processo Node richiesto a runtime.
- KaTeX per le formule.
- ForceGraph + d3-force per gli Universi.

## Contenuti locali

`data/catalog.json` è il registry dei cataloghi locali.

Ogni catalogo ha un manifest in `data/catalogs/`.

Le lezioni possono essere file JSON separati in `data/courses/` e vengono referenziate dal manifest tramite `src`.

Il loader espande i riferimenti in memoria, quindi il renderer lavora sempre su una struttura completa:

```text
Catalogo -> Librerie -> Lezioni -> Topics
```

## Contenuti cloud

Supabase salva il catalogo espanso in `catalogs.catalog_json`.

Campi principali:

- `owner_id`
- `slug`
- `title`
- `description`
- `tags`
- `is_public`
- `catalog_json`

`is_public = true` rende il catalogo visibile nella Home.

La RLS permette all'utente di leggere e modificare i propri cataloghi privati; gli altri utenti vedono soltanto quelli pubblici.

## Universe scopes

Il grafo usa gli stessi dati del reader e può essere filtrato a quattro livelli:

- **lezione** → lezione + topics
- **libreria** → libreria + lezioni + topics
- **catalogo** → catalogo + librerie + lezioni + topics
- **totale** → tutti i cataloghi accessibili

Nodi:

- `catalog`
- `library`
- `lesson`
- `topic`

Archi:

- `contains`
- `requires`
- `uses`
- `enables`
- `related`
- altri tipi dichiarati in `connections[]`

Il renderer è canvas-first per evitare i limiti di una grande mappa SVG.

## Community

`ratings` e `comments` usano:

- `target_kind`: `catalog`, `library`, `lesson` o `topic`
- `target_key`: path stabile del contenuto

Esempio:

`computer-vision/computer-vision/lesson-01-introduction/spatial-resolution`

## Auth

Google OAuth passa da Supabase Auth.

Il browser usa soltanto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Non devono mai essere esposte:

- service-role key
- client secret Google
- password del database

## Deployment Coolify

1. Repository GitHub.
2. Build con `Dockerfile`.
3. Porta interna `80`.
4. Per la modalità demo non servono env.
5. Per account e community:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `APP_URL`
6. Eseguire `supabase/schema.sql`.
7. Abilitare Google OAuth e aggiungere `APP_URL` ai redirect consentiti.
