# StudyLibrary

StudyLibrary è una biblioteca di studio **JSON-first** in cui corsi e argomenti formano uno **Spazio Universo** collegato. L'obiettivo non è archiviare slide: è trasformarle in percorsi leggibili, con prerequisiti, esempi, visuali, checkpoint e fonti.

## Cosa c'è già

- Home pubblica con ricerca su corsi **e argomenti**.
- Vista **Universo** con grafo pan/zoom e collegamenti tra topic.
- Reader del corso con indice, progressione e connessioni esplicite.
- Renderer JSON con testo, callout, formule KaTeX, immagini, flow, confronti, liste e checkpoint.
- **Studio JSON** nel browser: importa, valida, modifica, esporta, salva o pubblica.
- Google Login via Supabase Auth.
- Profili, corsi privati/pubblici, rating 1–5 e commenti via Supabase + RLS.
- Primo corso completo: `Computer Vision — Introduction`, ricostruito dal file CV01.
- Deploy Docker/Nginx pronto per Coolify.
- Modalità demo: il contenuto locale funziona anche senza backend.

## Preview locale

Serve un web server, perché i moduli ES e i JSON non vanno aperti con `file://`.

```bash
python -m http.server 8080
```

Poi apri `http://localhost:8080`.

## Coolify

Seleziona il **Dockerfile** del repository e configura:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
APP_URL=https://study.example.com
```

Il container genera `config.js` a runtime. Non inserire mai una Supabase service-role key nel frontend.

### Supabase

1. Crea/procurati un progetto Supabase.
2. Esegui `supabase/schema.sql` nel SQL editor.
3. In **Authentication → Providers → Google**, abilita Google e configura client ID/secret.
4. In **Authentication → URL Configuration**, aggiungi il dominio StudyLibrary tra i redirect URL.
5. Imposta le tre env in Coolify e redeploy.

## Aggiungere un corso da Git

1. Crea `data/courses/mio-corso.json`.
2. Aggiungi il file a `data/catalog.json`.
3. Segui `docs/CONTENT-SCHEMA.md`.
4. Commit + deploy.

## Aggiungere un corso dal browser

1. Accedi con Google.
2. Apri **Studio JSON**.
3. Importa un JSON oppure parti dal template.
4. Correggi gli errori segnalati dal validator.
5. **Salva** per una bozza personale oppure **Pubblica** per renderlo visibile in home.

## Content model

La regola di base per ogni topic è:

**perché → prerequisiti → intuizione → formalismo/esempio/visuale → checkpoint → fonti → collegamenti**

Dettagli e tipi di blocco in `docs/CONTENT-SCHEMA.md`.

## Struttura

```text
.
├── index.html
├── styles.css
├── app.js
├── js/
│   ├── api.js
│   ├── content.js
│   ├── graph.js
│   ├── state.js
│   └── ui.js
├── data/
│   ├── catalog.json
│   └── courses/
├── docs/
│   ├── ARCHITECTURE.md
│   └── CONTENT-SCHEMA.md
├── supabase/schema.sql
├── Dockerfile
├── nginx.conf
└── docker-entrypoint-study.sh
```

## Design direction

Il prodotto evita dashboard piene di card annidate. Il reader usa una colonna di lettura forte, divisori sottili e callout solo quando hanno un ruolo semantico. La mappa Universo è un livello di orientamento opzionale: non sostituisce la lettura lineare.
