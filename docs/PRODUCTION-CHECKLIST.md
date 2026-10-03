# Production checklist

Il codice necessario alla messa in produzione è già incluso nella repository. Restano soltanto le configurazioni legate agli account e all'infrastruttura.

## Prima del lancio pubblico

### Supabase

- Non eseguire manualmente `supabase/schema.sql`: applicare `supabase/migrations/` tramite il workflow GitHub **Deploy Supabase**.
- Verificare che Row Level Security sia attiva su `profiles`, `catalogs`, `ratings`, `comments` e `reports`.
- Abilitare Google OAuth.
- Aggiungere il dominio di produzione agli URL di redirect.
- Verificare con **due account distinti**:
  - A vede e modifica i propri cataloghi privati.
  - B non può leggere o modificare i cataloghi privati di A.
  - Entrambi vedono i cataloghi pubblici.
  - Ogni utente può modificare/eliminare solo i propri commenti.
  - Le segnalazioni possono essere create solo dall'utente autenticato.

### Coolify

Impostare:

```text
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
APP_URL=https://study.ddone.it
```

La service-role key **non deve** essere esposta al browser.

### Google

Configurare le credenziali OAuth nel progetto Google e nel provider Supabase. Il client secret resta lato Supabase.

## Già implementato nel codice

- Row Level Security.
- Cataloghi privati/pubblici.
- Eliminazione cataloghi.
- Export dei cataloghi personali.
- Eliminazione dei propri contenuti cloud.
- Eliminazione self-service dell’account Auth tramite RPC protetta.
- Modifica/eliminazione dei propri commenti.
- Segnalazione di cataloghi/commenti.
- Rate limit database per commenti e segnalazioni.
- Cleanup dei commenti/rating/report orfani alla cancellazione di un catalogo.
- CSP, Permissions Policy, frame protection e referrer policy.
- Error state e retry.
- Fallback per immagini esterne non raggiungibili.
- Privacy e Termini accessibili dal footer.
- Metadata Open Graph/Twitter, manifest, robots e sitemap root.
- Test automatici e validazione dei JSON via GitHub Actions.

## Comandi locali

```bash
npm run check
npm run validate
npm test
# oppure
npm run ci
```

## Moderazione

Le segnalazioni vengono salvate nella tabella `reports`. Non esiste volutamente una dashboard admin pubblica: la lettura globale delle segnalazioni deve avvenire con strumenti amministrativi/server-side, non attraverso la anon key del frontend.

## Backup

I cataloghi personali possono essere esportati dall'account in un unico JSON. Per il database completo configura inoltre backup/PITR secondo il piano Supabase scelto.

## Legal

Le pagine Privacy e Termini incluse sono coerenti con il funzionamento del codice, ma prima di un lancio commerciale/pubblico vanno revisionate dal gestore dell'istanza in base a società, hosting, paese, retention e procedure reali.


## GitHub Secrets per Deploy Supabase

Configura in GitHub → Settings → Secrets and variables → Actions:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
SUPABASE_PROJECT_REF
SUPABASE_POOLER_HOST
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET
```

Dopo averli inseriti, vai in Actions → **Deploy Supabase** → Run workflow.

La configurazione URL/Auth è dichiarata in `supabase/config.toml`, quindi Site URL, redirect URL e provider Google vengono applicati dal workflow insieme alle migration.


Note: il deploy Auth non usa `supabase config push` in CI, così il token scoped non necessita del permesso Infrastructure Add-ons. Sono sufficienti i permessi già richiesti per link del progetto e Auth config.
