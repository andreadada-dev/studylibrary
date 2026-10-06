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
- Editor visuale Markdown + JSON avanzato, import/export, salvataggio privato e pubblicazione.
- Knowledge API pubblica per cataloghi/librerie/lezioni/topic con controllo gerarchico.
- Self-describing agent protocol su `/api/v1/agent` + audit automatico per catalogo.
- Versioning automatico, cronologia, ripristino e diff degli import.
- Google Login via Supabase.
- Rating e commenti con Row Level Security.
- Docker/Nginx pronto per Coolify.
- Modalità demo senza backend.

## Contenuti personali

Il repository non contiene più cataloghi demo obbligatori. I contenuti principali vivono nello spazio personale dell'utente su Supabase.

Da **Il mio catalogo** puoi:

- trascinare file JSON;
- vedere Cataloghi → Librerie → Lezioni → Argomenti;
- aprire l'Universo personale;
- modificare i contenuti con editor visuale Markdown;
- usare il JSON avanzato quando serve;
- pubblicare o mantenere privato ogni catalogo.

## Knowledge API e versioning

Ogni catalogo può abilitare una API pubblica in sola lettura, indipendente dalla visibilità nella Home.

Endpoint principale:

```text
https://study.ddone.it/api/v1
```

Sono disponibili:

- catalog/export completo filtrato;
- `/context` compatto per AI;
- `/graph` per nodi e collegamenti;
- endpoint per librerie, lezioni e topic;
- cronologia versioni;
- diff da una versione precedente;
- endpoint di scrittura autenticato con optimistic concurrency.

Ogni salvataggio significativo crea automaticamente uno snapshot immutabile. Il ripristino crea una nuova versione senza cancellare la cronologia.

Documentazione completa: `docs/API.md`.

Per agent/AI il punto di ingresso canonico è `https://study.ddone.it/api/v1/agent` (anche `/.well-known/studylibrary.json`).

Per aggiornamenti incrementali generati da AI/agent usa il formato version-aware descritto in `docs/UPDATE-PACKAGE.md`.

## Coolify

Build con il `Dockerfile`, porta interna `80`.

Per la sola modalità demo non servono variabili.

Per account e community:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_ANON_KEY
APP_URL=https://study.example.com
```

Il database non va più inizializzato a mano dal SQL Editor: usa le migration in `supabase/migrations/` e il workflow GitHub **Deploy Supabase**. `supabase/schema.sql` resta soltanto come snapshot leggibile dello schema.

## Struttura

```text
data/
└── catalog.json                  # registry opzionale di contenuti locali

js/
├── catalog-editor.js             # editor visuale Markdown
├── content.js                    # loader, validazione e graph model
├── api.js                        # accesso Supabase
└── graph.js                      # Universo

supabase/
├── migrations/                   # schema/versioning/API
└── schema.sql                    # snapshot leggibile
```

Il flusso principale usa cataloghi cloud espansi come JSONB; i file locali sono opzionali.


## Qualità e produzione

Prima del lancio pubblico consulta `docs/PRODUCTION-CHECKLIST.md`.

Controlli disponibili:

```bash
npm run check
npm run validate
npm test
npm run ci
```

La repository include una GitHub Action che esegue automaticamente syntax check, validazione dei cataloghi JSON e test del modello Catalogo → Libreria → Lezione → Argomento.

Sono inoltre inclusi:

- modifica/eliminazione dei propri commenti;
- segnalazione di cataloghi e commenti;
- rate limit database per commenti/segnalazioni;
- export dei cataloghi personali;
- eliminazione dei propri contenuti cloud;
- pagine Privacy e Termini;
- header HTTP di sicurezza;
- fallback di rete/immagini;
- cleanup dei dati community alla cancellazione di un catalogo.

Le configurazioni che restano manuali sono Supabase, Google OAuth, dominio/redirect e variabili Coolify.


## Supabase migrations

Lo schema è versionato in:

`supabase/migrations/`

Per il primo deploy:

1. crea il progetto Supabase;
2. crea le GitHub Actions secrets richieste da `.github/workflows/deploy-supabase.yml`;
3. esegui manualmente il workflow **Deploy Supabase**.

Il workflow esegue:

```text
supabase link
supabase db push --dry-run
supabase db push
Management API Auth PATCH
```

Quindi applica sia le migration PostgreSQL sia la configurazione Auth dichiarata in `supabase/config.toml`.


Note: il deploy Auth non usa `supabase config push` in CI, così il token scoped non necessita del permesso Infrastructure Add-ons. Sono sufficienti i permessi già richiesti per link del progetto e Auth config.
