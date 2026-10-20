# StudyLibrary

StudyLibrary è una piattaforma di studio **visual-first, con import/export JSON** organizzata così:

**Utente → Catalogo → Librerie → Lezioni → Argomenti**

Un utente può tenere il proprio catalogo privato oppure pubblicarlo nella Home. Ogni libreria può contenere una o più lezioni; ogni lezione ha i propri topic, fonti, esempi, checkpoint e collegamenti.


## Esperienza di studio e editor (ottobre 2026)

- **Home personale per utenti autenticati:** cartelle personali, ultimi argomenti visitati, segnalibri manuali, preferiti e conteggio degli argomenti completati. La community rimane disponibile sotto.
- **Ricerca profonda:** dalla Home è possibile aprire direttamente un catalogo, una libreria, una lezione oppure un topic trovato nel titolo, sommario o descrizione, inclusi i contenuti personali accessibili all'account.
- **Progresso reale:** un argomento può essere segnato come completato (o nuovamente incompleto) nel reader. La barra della lezione conta i topic completati, non la semplice posizione corrente.
- **Editor sicuro:** bozze locali per utente/catalogo con recupero al rientro, conferma prima di lasciare modifiche non salvate, Annulla/Ripristina, conferma delle eliminazioni e riordino dei blocchi con drag & drop (desktop) o frecce (touch e tastiera).
- **Nomi comprensibili:** i tipi di sezione visualizzati nell'editor sono etichettati in italiano; nel JSON rimangono i tipi originali del protocollo.
- **Preferiti:** filtri per tipo di contenuto, ricerca testuale e ordinamento.

Le bozze locali rimangono sul dispositivo e **non** equivalgono a un salvataggio cloud: per sincronizzare modifiche e cronologia versioni bisogna premere **Salva modifiche**. Il recupero della bozza viene offerto quando la versione cloud di partenza non è cambiata. Su dispositivi condivisi evita di lasciare bozze contenenti materiale riservato.

Il completamento e le ultime letture richiedono la migrazione Supabase `20261020213500_study_progress.sql`: se non è stata distribuita, l'interfaccia non inventa percentuali di progresso.

## Libro 3D nella modalità Concentrazione (StPageFlip)

Nella pagina di una lezione premi **Concentrati**: il lettore apre un libro con copertina rigida, pagine HTML, piegatura 3D e ombre realistiche. Puoi sfogliare con gli angoli della carta, con i pulsanti **Precedente / Successiva** o con le frecce della tastiera. Desktop: due pagine affiancate; mobile: una pagina. Il pulsante **Scorrimento** torna subito alla lettura continua senza lasciare la modalità Concentrazione. Le opzioni `Aa` continuano a funzionare e reimpaginano il libro.

La pagina è composta dal contenuto HTML già presente nel reader (formule KaTeX, spiegazioni, immagini e checkpoint). L'impaginazione cerca di non spezzare i blocchi: se necessario divide paragrafi lunghi mantenendo la formattazione, oppure usa un piccolo scorrimento interno per elementi indivisibili. Per non distrarre, discussione, collegamenti e fonti secondarie rimangono nella lettura continua.

La libreria è **StPageFlip 2.0.7 (MIT, © Nodlik 2020)**. Il Dockerfile distribuisce `/js/vendor/page-flip.browser.js` e la relativa licenza insieme all'app, per evitare dipendenze dal CDN in produzione. In sviluppo locale senza bundle installato è disponibile un fallback jsDelivr alla versione fissata; se la libreria non è raggiungibile, il reader torna automaticamente alla lettura continua. Il blocco del bundle nella rete non impedisce la consultazione del contenuto.

Test di comportamento e responsive: `Visual and mobile smoke` verifica il bundle reale in Chromium nelle viste desktop/iPhone. Questo non sostituisce un test su dispositivi fisici con lezioni e PDF reali.

## Editor visuale, media e organizzazione

- **Palette + Blocco:** negli argomenti scegli tra testo, esempio, formula, immagine, galleria, PDF/risorsa, confronto, procedimento e checkpoint. Le sezioni mantengono il formato dati già esistente.
- **Anteprima lezione:** dall'editor attiva **Anteprima lezione** e seleziona un argomento dalla struttura; le modifiche vengono visualizzate senza pubblicare.
- **Riordino:** cartelle personali, librerie, lezioni e sezioni possono essere spostate con trascinamento desktop o con frecce su mobile/tastiera.
- **Upload diretto:** nel catalogo puoi caricare immagini; nel singolo argomento puoi caricare immagini o PDF. Accettati JPEG, PNG, WebP, GIF e AVIF (max 6 MB), PDF (max 10 MB).
- **PDF:** il lettore mostra un'anteprima incorporata quando consentito dal browser, con un collegamento per aprire il documento in un'altra scheda.
- **CSS più manutenibile:** gli stili aggiunti per studio, editor e responsive sono in `styles-study.css`; `styles.css` contiene la base e le regole legacy.

**Attenzione alla visibilità dei file:** il bucket `study-media` utilizza **URL pubblici**, anche quando il catalogo è privato. L'app richiede conferma prima dell'upload. Non caricare documenti riservati o materiale protetto da copyright senza autorizzazione. La visibilità del catalogo e la visibilità dei file caricati sono due impostazioni diverse.

Migrazioni richieste:
- `20261020213500_study_progress.sql` — completamento e ultime letture;
- `20261020220000_study_media_bucket.sql` — bucket media e policy di scrittura per utente;
- `20261020221000_study_catalog_order.sql` — ordinamento dei cataloghi sincronizzato tra dispositivi.

Le migrazioni sono versionate, **ma non vengono eseguite automaticamente dai commit**. Distribuiscile tramite il workflow manuale **Deploy Supabase** prima di utilizzare tutte le nuove funzionalità in produzione.

### Controlli automatici

`npm run ci` esegue validazione JS/SQL, controllo dati e test unitari.
Il workflow `Visual and mobile smoke` usa Playwright/Chromium in viewport desktop, iPhone 13 e iPhone SE; genera screenshot e trace in GitHub Actions. È **emulazione browser**, non collaudo su telefoni fisici. La prova reale su dispositivi e la verifica con login Supabase richiedono un test separato.

## Funzioni principali

- Home con i **cataloghi pubblicati** dalla community.
- Area **Il mio catalogo** per contenuti privati/pubblici dell'utente.
- Librerie organizzate in **lezioni**, adatte a corsi universitari con slide separate per lezione.
- Reader progressivo per i topic della singola lezione.
- **Universo della lezione**, della libreria, del catalogo e Universo totale.
- Force graph fullscreen con ricerca, zoom, drag, focus e pannello nodo.
- Editor visuale Markdown + JSON avanzato, import/export, salvataggio privato e pubblicazione.
- Libreria media per immagini/video e upload di immagini e PDF; URL inline auto-registrati, `mediaRef`, gallery, YouTube/Vimeo e provenienza delle fonti.
- Knowledge API pubblica per cataloghi/librerie/lezioni/topic con controllo gerarchico.
- Self-describing **Agent Protocol v2** su `/api/v1/agent` + audit automatico per catalogo.
- JSON di aggiornamento incrementale (`studylibrary.update`, v2): patch puntuali di topic, sezioni, lezioni, media e fonti senza scambiare il catalogo completo.
- Import version-aware con diff, conferma e salvataggio atomico `baseVersion` (protezione da modifiche concorrenti).
- Versioning automatico, cronologia, ripristino e diff degli import.
- Google Login via Supabase.
- Rating e commenti con Row Level Security.
- Docker/Nginx pronto per Coolify.
- Modalità demo senza backend.

## Contenuti personali

Il repository non contiene più cataloghi demo obbligatori. I contenuti principali vivono nello spazio personale dell'utente su Supabase.

Da **I miei cataloghi** puoi:

- scegliere **+ Nuovo catalogo** direttamente dalla griglia (nessun JSON richiesto);
- aprire una cartella per consultare il catalogo oppure cliccare **Modifica catalogo**;
- all'interno del catalogo usare **+ Libreria**, dentro una libreria **+ Lezione** e dentro una lezione **+ Argomento**;
- modificare direttamente la libreria, la lezione o il topic selezionato: l'editor si apre sul contenuto richiesto;
- importare cataloghi o pacchetti `studylibrary.update` da **Importa / aggiorna JSON** (o tramite trascinamento);
- aprire l'Universo personale e gestire pubblicazione e privacy.

L'Editor non è più un collegamento globale ambiguo nella navbar. L'accesso è contestuale e proprietario: `#/studio/new` per creare e `#/studio/catalog/{uuid}/...` per modificare. L'interfaccia mostra subito le azioni principali di salvataggio e tiene gli strumenti JSON sotto **Strumenti avanzati**; il salvataggio di cataloghi già esistenti usa il controllo atomico della versione.

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

Per aggiornamenti incrementali AI usa `schemaVersion: 2` e `docs/UPDATE-PACKAGE.md`: è possibile aggiungere una singola sezione con un JSON piccolo. Le API pubbliche restano di sola lettura; la UI importa il pacchetto e salva con l'account del proprietario.

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

La repository include una GitHub Action che esegue automaticamente syntax check JavaScript, controllo lessicale delle migration SQL, validazione dei cataloghi JSON, test media/protocollo e build Docker/Nginx.

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
