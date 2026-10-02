# Security

## Segnalazione vulnerabilità

Non pubblicare credenziali, token o dettagli di vulnerabilità sfruttabili in issue pubbliche. Segnala il problema al maintainer del deployment.

## Segreti

Nel browser sono ammessi soltanto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Non committare o esporre:

- Supabase service-role key
- Google OAuth client secret
- password database
- token amministrativi

## Modello autorizzativo

L'autorizzazione dei dati cloud è applicata da PostgreSQL tramite Row Level Security. Il frontend non è considerato un confine di sicurezza.

## Protezioni incluse

- cataloghi privati leggibili soltanto dal proprietario;
- scrittura dei cataloghi limitata al proprietario;
- commenti/rating modificabili solo dal rispettivo autore;
- segnalazioni attribuite all'utente autenticato;
- rate limit database su commenti e report;
- CSP e header HTTP di sicurezza;
- escaping HTML dei contenuti JSON renderizzati;
- nessuna service-role key nel frontend.

## Dipendenze CDN

KaTeX, D3, ForceGraph e Supabase JS vengono caricati da jsDelivr. Per ambienti con requisiti di supply-chain più rigidi è consigliato vendorare e versionare localmente gli asset prima del lancio.
