# Architecture

## Obiettivo

StudyLibrary deve restare semplice da distribuire su Coolify ma supportare autenticazione, contenuti personali e community. Per questo la prima versione separa chiaramente:

- **Frontend statico**: HTML, CSS e JavaScript ES modules.
- **Contenuti portabili**: JSON nel repository oppure `jsonb` nel database.
- **Backend managed/self-hostable**: Supabase per Google OAuth, Postgres, Row Level Security, rating e commenti.
- **Deploy**: Nginx in un container Docker. Nessun processo Node necessario in produzione.

## Perché non un CMS pesante

Il contenuto di studio deve poter essere:

1. modificato con un editor di testo;
2. generato da strumenti automatici;
3. revisionato con Git diff;
4. importato/esportato senza lock-in;
5. visualizzato nella stessa UI sia da file locale sia da database.

Il JSON è quindi il contratto. Il database memorizza lo stesso documento per gli utenti che vogliono pubblicare dal browser.

## UI/UX principles

La UI prende spunto da tre famiglie di prodotti, senza copiarne il look:

- **Knowledge bases**: gerarchia chiara, ricerca veloce, reader concentrato.
- **Digital gardens / knowledge graphs**: backlinks e relazioni visibili, mappa globale opzionale.
- **Infinite canvas tools**: pan/zoom e manipolazione diretta nella vista Universo.

Regole locali:

- max ~760 px per il testo lungo;
- un solo livello principale di superficie per sezione;
- bordi solo per separare funzioni, non per decorare ogni blocco;
- callout solo quando il significato lo richiede;
- sidebar del corso = indice, non dashboard;
- l'Universo è una vista complementare, non il modo obbligatorio di leggere;
- mobile: reader lineare, indice orizzontale e navigazione bottom floating.

## Data flow

### Locale

`data/catalog.json` → file corso → renderer.

Questo percorso funziona senza account e senza Supabase.

### Cloud

Supabase `courses.course_json` → merge per `slug` con i corsi locali → renderer.

A parità di `slug`, la versione remota ha precedenza. Questo permette di partire da un corso in Git e sostituirlo con una versione pubblicata dal browser.

### Community

`ratings` e `comments` usano una coppia generica:

- `target_kind`: `course` o `topic`;
- `target_key`: es. `computer-vision-introduction/spatial-resolution`.

Non serve una tabella commenti per ogni tipo di contenuto.

## Auth

Il browser usa solo la Supabase **anon key**. Le autorizzazioni vere sono nel database tramite RLS.

Mai mettere nel frontend:

- service role key;
- client secret Google;
- password database.

Google OAuth reindirizza all'`APP_URL` configurato nel container.

## Search

La v1 usa ricerca client-side su corsi già caricati. Per una biblioteca ampia conviene aggiungere una seconda fase:

- Postgres Full Text Search su titolo, description e topic estratti dal JSON;
- oppure un indice dedicato (Typesense/Meilisearch) se il catalogo diventa molto grande.

## Knowledge graph

La vista Universo usa D3 force simulation.

Nodi:

- corso;
- topic.

Archi:

- course → topic (`contains`);
- prerequisite → topic (`requires`);
- `connections[]` definite nel JSON.

Per grafi grandi è consigliabile filtrare per corso/modulo e caricare progressivamente i vicini del nodo selezionato.

## Deployment on Coolify

1. Sorgente: repository GitHub.
2. Build pack: Dockerfile.
3. Porta: 80.
4. Env:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `APP_URL`
5. In Supabase aggiungi `APP_URL` tra gli URL OAuth consentiti.
6. Applica `supabase/schema.sql` una volta.

L'entrypoint crea `/usr/share/nginx/html/config.js` a runtime. Così la stessa immagine Docker può essere promossa tra ambienti con configurazioni diverse.
