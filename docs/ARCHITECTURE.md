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
- Nginx serve il frontend statico e fa da proxy same-origin verso le RPC pubbliche Supabase per `/api/v1`.
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
- `is_public`\n- `api_public`\n- `current_version`\n- `version_message`\n- `catalog_json`

`is_public = true` rende il catalogo visibile nella Home. `api_public = true` abilita invece la lettura tramite Knowledge API; i due stati sono indipendenti.

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


## Moderazione e abuso

La community usa tre tabelle separate:

- `comments`
- `ratings`
- `reports`

Le segnalazioni possono riferirsi a cataloghi, librerie, lezioni, topic o commenti. Il frontend consente agli utenti di modificare/eliminare soltanto i propri commenti e di segnalare contenuti altrui.

Il database applica un rate limit di base tramite trigger PostgreSQL per evitare burst di commenti e segnalazioni. La moderazione globale dei report resta server-side/amministrativa e non viene esposta alla anon key.

Quando un catalogo cloud viene eliminato, un trigger rimuove anche rating, commenti e report che puntano al suo identificatore stabile o a contenuti figli.

## Portabilità e cancellazione

Dall'account l'utente può:

- esportare tutti i propri cataloghi cloud in JSON;
- eliminare i propri cataloghi/commenti/rating/report applicativi.

La cancellazione dell'identità Auth richiede invece una procedura amministrativa/server-side Supabase, perché non deve essere autorizzata dalla anon key.


## Knowledge API

Il browser e i client esterni usano:

```text
https://study.ddone.it/api/v1
```

Nginx inoltra le richieste pubbliche alla RPC PostgreSQL `studylibrary_api(path)`, aggiungendo la Publishable Key.

La funzione è `SECURITY DEFINER` ma applica esplicitamente:

- `catalogs.api_public` sul catalogo;
- ereditarietà `api.publicRead` su librerie, lezioni e topic;
- filtraggio dei contenuti non esposti.

La scrittura esterna passa invece da `studylibrary_api_write(...)` e richiede il JWT Supabase dell'utente. La funzione verifica `auth.uid()` e la proprietà del catalogo.

## Versioning

`catalog_versions` contiene snapshot immutabili del catalogo.

Due trigger gestiscono il flusso:

```text
UPDATE/INSERT catalogs
        ↓
prepare_catalog_version
        ↓
current_version + 1
        ↓
snapshot_catalog_version
        ↓
catalog_versions
```

Sono versionate le modifiche a:

- JSON del catalogo;
- metadata;
- pubblicazione Home;
- pubblicazione API.

`restore_catalog_version()` ripristina uno snapshot creando una nuova versione invece di riscrivere la storia.

Per aggiornamenti esterni, `studylibrary_api_write` accetta `p_base_version`: se non coincide con la versione corrente restituisce un conflitto e impedisce sovrascritture accidentali.
