# Puma Utilities

Puma Utilities is a mobile-first, local-first Release 1 workspace for public
multifamily water research in NJ, NY, and PA, plus future client-authorized
monitoring.

## Release 1 boundary

- Five source-linked companies ship as **Research** targets, never clients.
- A portfolio statement is shown with its exact public terminology: buildings,
  properties, locations, or communities are not interchangeable.
- A score is withheld until all required factors are sourced. Unknown evidence
  is not treated as zero or as a water problem.
- Monitor evaluates only Client-stage companies with client-authorized readings.
  Public research cannot create an alert, meter record, tariff, bill, or usage
  claim.
- Source catalog entries are official references, not live connectors. Puma
  stores no portal credentials and does not automate utility portals.
- Browser workspaces persist per device in local storage. The safe public API
  exposes only the static research seeds, never local or authorized data.

## Routes

- `/` — workspace home
- `/clients` — searchable company directory
- `/clients/[companyId]` — refresh-safe company detail and evidence trail
- `/monitor` — client-authorized exceptions only
- `/engine` — source catalog and scoring boundary
- `/settings` — truthful integration status, local export, and safe update
- `/api/health` and `/api/prospects` — release metadata/static public summaries

## Run and verify

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The PWA update flow scopes cache retirement to `puma-utilities-*` cache names
and never clears browser local workspace data.
